import { describe, expect, test } from "bun:test"
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import type * as Path from "effect/Path"
import type * as Scope from "effect/Scope"
import type { ChildProcessSpawner } from "effect/unstable/process"

import { FreshSelection, spawnFreshRun } from "./freshRun.js"

const platform = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

// Spawns a real child of the current runtime; give it room, as the coverage
// collector's suite does.
const TIMEOUT_MS = 30_000

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Scope.Scope
  >,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(platform)))

/** A catalog whose one play asserts the number it is written with. */
const catalogFile = (expected: number): string =>
  [
    "export const showcases = [",
    "  {",
    '    id: "tmp/counts",',
    "    play: () => {",
    `      if (1 !== ${expected}) {`,
    `        throw new Error("expected ${expected}")`,
    "      }",
    "    },",
    "  },",
    "]",
    "",
  ].join("\n")

describe("spawnFreshRun", () => {
  test(
    "runs the code on disk, not the code the parent has already imported",
    async () => {
      const { after, before } = await run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          // Through its real path: on macOS the temp directory is reached over
          // a symlink, and the two spellings are two module URLs.
          const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
          const file = `${dir}/counts.showcase.ts`
          const selection = FreshSelection.One({ id: "tmp/counts" })

          yield* fs.writeFileString(file, catalogFile(1))
          const before = yield* spawnFreshRun(selection, [file])
          // The parent imports the very same file, so its own module cache now
          // holds the passing version — which is the trap this exists to avoid.
          yield* Effect.promise(() => import(file))
          yield* fs.writeFileString(file, catalogFile(2))
          const after = yield* spawnFreshRun(selection, [file])
          return { after, before }
        }),
      )

      expect(before._tag).toBe("foldcase/RanShowcase")
      expect(after._tag).toBe("foldcase/RanShowcase")
      if (before._tag !== "foldcase/RanShowcase" || after._tag !== "foldcase/RanShowcase") {
        throw new Error("expected two single-Showcase runs")
      }
      expect(before.report.status).toBe("passed")
      // The edit landed: the second run read the file as it is now.
      expect(after.report.status).toBe("failed")
      expect(after.report.error?.message).toBe("expected 2")
    },
    TIMEOUT_MS,
  )

  test(
    "answers the available ids for an id the fresh catalog does not carry",
    async () => {
      const document = await run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
          const file = `${dir}/counts.showcase.ts`
          yield* fs.writeFileString(file, catalogFile(1))
          return yield* spawnFreshRun(FreshSelection.One({ id: "tmp/gone" }), [file])
        }),
      )

      expect(document._tag).toBe("foldcase/NoSuchShowcase")
      if (document._tag !== "foldcase/NoSuchShowcase") {
        throw new Error("expected a missing-Showcase answer")
      }
      expect(document.available).toEqual(["tmp/counts"])
    },
    TIMEOUT_MS,
  )

  test(
    "runs a whole catalog into one suite, folding in a file that would not load",
    async () => {
      const document = await run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath))
          const good = `${dir}/counts.showcase.ts`
          const bad = `${dir}/bad.showcase.ts`
          yield* fs.writeFileString(good, catalogFile(1))
          yield* fs.writeFileString(bad, "export const showcases = 7\n")
          return yield* spawnFreshRun(FreshSelection.Every(), [good, bad])
        }),
      )

      expect(document._tag).toBe("foldcase/RanSuite")
      if (document._tag !== "foldcase/RanSuite") {
        throw new Error("expected a suite run")
      }
      expect(document.suite.total).toBe(2)
      expect(document.suite.passed).toBe(1)
      expect(document.suite.reports.map((report) => report.id)).toContainEqual(
        expect.stringContaining("bad.showcase.ts"),
      )
    },
    TIMEOUT_MS,
  )
})
