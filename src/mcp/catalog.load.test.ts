import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type * as Scope from "effect/Scope"

import { CatalogDirectoryError, loadCatalogFromDir } from "./catalog.js"

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const testDir = `${repoRoot}/test`
const fixtures = `${testDir}/fixtures`
const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const run = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(PlatformLive)))

/** A minimal catalog file: no imports, so it loads under either runtime. */
const catalogFile = (id: string): string =>
  `export const showcases = [{ id: ${JSON.stringify(id)}, play: () => {} }]\n`

describe("loadCatalogFromDir", () => {
  test("discovers *.showcase.ts under a directory and exposes them as a catalog", async () => {
    const listing = await run(
      loadCatalogFromDir(fixtures).pipe(Effect.flatMap((catalog) => catalog.list)),
    )

    const ids = listing.showcases.map((entry) => entry.id)
    expect(ids).toContain("sample/passes")
    expect(ids).toContain("sample/fails")
  })
})

describe("FoldcaseCatalog load", () => {
  test("re-reads the directory, so a Showcase written after startup is served", async () => {
    // The server loads once at startup. An agent that has just written a
    // Showcase must be able to see it without restarting the host.
    const { after, before, report } = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        // Through its real path: on macOS the temp directory is reached over a
        // symlink, and a module resolver that has walked one spelling of a
        // directory will not see a file added under the other.
        const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
        yield* fs.writeFileString(`${dir}/one.showcase.ts`, catalogFile("tmp/one"))
        const catalog = yield* loadCatalogFromDir(dir)
        const before = yield* catalog.list
        yield* fs.writeFileString(`${dir}/two.showcase.ts`, catalogFile("tmp/two"))
        const report = yield* catalog.load(Option.none())
        const after = yield* catalog.list
        return { after, before, report }
      }),
    )

    expect(before.showcases.map((entry) => entry.id)).toEqual(["tmp/one"])
    expect(report.showcaseCount).toBe(2)
    expect(report.failures).toEqual([])
    expect(after.showcases.map((entry) => entry.id)).toEqual(["tmp/one", "tmp/two"])
  })

  test("loads another directory on request, resolving a relative one against the root", async () => {
    const { listing, report } = await run(
      Effect.gen(function* () {
        const catalog = yield* loadCatalogFromDir(testDir)
        const report = yield* catalog.load(Option.some("fixtures"))
        const listing = yield* catalog.list
        return { listing, report }
      }),
    )

    // The directory travels with every answer, so an agent never has to guess
    // which catalog it is reading.
    expect(report.dir).toBe(fixtures)
    expect(listing.dir).toBe(fixtures)
    expect(listing.showcases.map((entry) => entry.id)).toContain("sample/passes")
    expect(listing.showcases.map((entry) => entry.id)).not.toContain("counter/logic")
  })

  test("reports the files it could not read, and serves the rest", async () => {
    const report = await run(
      Effect.gen(function* () {
        const catalog = yield* loadCatalogFromDir(testDir)
        return yield* catalog.load(Option.none())
      }),
    )

    expect(report.showcaseCount).toBeGreaterThan(0)
    expect(report.failures.map((failure) => failure.path)).toContainEqual(
      expect.stringContaining("broken-import"),
    )
  })

  test("runs the loaded catalog to the verdict `foldcase test` gives", async () => {
    const suite = await run(
      Effect.gen(function* () {
        const catalog = yield* loadCatalogFromDir(testDir)
        return yield* catalog.runAll(Option.none())
      }),
    )

    // A file that would not load is a failed entry beside the plays, so the
    // suite an agent reads over MCP says the same thing as the CLI's.
    expect(suite.reports.map((report) => report.id)).toContainEqual(
      expect.stringContaining("broken-import"),
    )
    expect(suite.failed).toBeGreaterThan(0)
    expect(suite.total).toBe(suite.reports.length)
  })

  test("fails CatalogDirectoryError for a directory that is not there, and serves on", async () => {
    const { error, listing } = await run(
      Effect.gen(function* () {
        const catalog = yield* loadCatalogFromDir(fixtures)
        const error = yield* Effect.flip(catalog.load(Option.some("no-such-dir")))
        const listing = yield* catalog.list
        return { error, listing }
      }),
    )

    expect(error).toBeInstanceOf(CatalogDirectoryError)
    expect(error.dir).toBe(`${fixtures}/no-such-dir`)
    // A load that failed leaves the catalog it was serving untouched.
    expect(listing.showcases.map((entry) => entry.id)).toContain("sample/passes")
  })
})
