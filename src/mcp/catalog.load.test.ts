import { describe, expect, test } from "bun:test"
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type * as Scope from "effect/Scope"
import type { ChildProcessSpawner } from "effect/unstable/process"

import { CatalogDirectoryError, loadCatalogFromDir } from "./catalog.js"

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const testDir = `${repoRoot}/test`
const fixtures = `${testDir}/fixtures`
// A dir-backed catalog runs its plays in a child process, so the spawner is
// part of the platform a real server hands it.
const PlatformLive = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Scope.Scope
  >,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(PlatformLive)))

/** A minimal catalog file: no imports, so it loads under either runtime. */
const catalogFile = (id: string): string =>
  `export const showcases = [{ id: ${JSON.stringify(id)}, play: () => {} }]\n`

/** The same, with a play that fails on the message it is written with. */
const failingCatalogFile = (id: string, message: string): string =>
  [
    "export const showcases = [",
    `  { id: ${JSON.stringify(id)}, play: () => { throw new Error(${JSON.stringify(message)}) } },`,
    "]",
    "",
  ].join("\n")

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

describe("a dir-backed catalog runs what is on disk", () => {
  // The blind spot this closes: both runtimes cache an ES module by URL, so a
  // server that ran a play in its own process re-ran the module it had already
  // imported. The agent read a report of the code it had just replaced and
  // concluded its fix had not worked — with no reload verb able to help,
  // because a reload imports the same URL.

  test("reruns an edited play without a reload, and reports the new failure", async () => {
    const { after, before } = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
        const file = `${dir}/one.showcase.ts`
        yield* fs.writeFileString(file, catalogFile("tmp/one"))
        const catalog = yield* loadCatalogFromDir(dir)
        const before = yield* catalog.runById("tmp/one")
        // No catalog.load between the two runs: freshness is a property of the
        // run itself, not of a verb the agent has to remember to call.
        yield* fs.writeFileString(file, failingCatalogFile("tmp/one", "the edit landed"))
        const after = yield* catalog.runById("tmp/one")
        return { after, before }
      }),
    )

    expect(before.status).toBe("passed")
    expect(after.status).toBe("failed")
    expect(after.error?.message).toBe("the edit landed")
  })

  test("runs a Showcase written after startup, because every run rediscovers", async () => {
    const suite = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
        yield* fs.writeFileString(`${dir}/one.showcase.ts`, catalogFile("tmp/one"))
        const catalog = yield* loadCatalogFromDir(dir)
        yield* fs.writeFileString(`${dir}/two.showcase.ts`, catalogFile("tmp/two"))
        return yield* catalog.runAll(Option.none())
      }),
    )

    expect(suite.reports.map((report) => report.id)).toEqual(["tmp/one", "tmp/two"])
  })

  test("keeps the errors the tools declare: the unknown id, and the prefix that matched nothing", async () => {
    const { matched, unknown } = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
        yield* fs.writeFileString(`${dir}/one.showcase.ts`, catalogFile("tmp/one"))
        const catalog = yield* loadCatalogFromDir(dir)
        const unknown = yield* Effect.flip(catalog.runById("tmp/gone"))
        const matched = yield* Effect.flip(catalog.runAll(Option.some("nope/")))
        return { matched, unknown }
      }),
    )

    expect(unknown._tag).toBe("foldcase/ShowcaseNotFoundError")
    // The ids come back from the fresh read, so an agent can correct itself in
    // one turn even when the catalog changed under the server.
    expect(unknown.available).toEqual(["tmp/one"])
    expect(matched._tag).toBe("foldcase/NoShowcaseMatchedError")
    expect(matched.available).toEqual(["tmp/one"])
  })
})
