import { describe, expect, test } from "bun:test"
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { loadShowcasesFromFiles } from "../cli.js"
import { collectCoverage } from "./collect.js"
import { formatCoverage } from "./report.js"

const fixtures = `${import.meta.dir}/../../test/fixtures`
const uncollectable = `${import.meta.dir}/../../test/uncollectable`
const platform = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

// Spawns a real Node subprocess (like kernel/Process.test.ts); give it room.
const TIMEOUT_MS = 30_000

describe("collectCoverage", () => {
  test(
    "runs the Showcases under Node and reports per-Showcase + aggregate coverage",
    async () => {
      const files = [`${fixtures}/sample.showcase.ts`]
      const report = await Effect.runPromise(
        loadShowcasesFromFiles(files).pipe(
          Effect.flatMap((load) => collectCoverage(fixtures, files, load.showcases)),
          Effect.provide(platform),
        ),
      )

      // The sample fixture's own file is covered (its plays executed).
      const file = report.files.find((entry) => entry.path.endsWith("sample.showcase.ts"))
      expect(file).toBeDefined()
      expect(file?.coveredLines).toBeGreaterThan(0)

      // Per-Showcase attribution: both sample Showcases show up by id.
      const ids = report.showcases.map((showcase) => showcase.id)
      expect(ids).toContain("sample/passes")
      expect(ids).toContain("sample/fails")
    },
    TIMEOUT_MS,
  )

  test(
    "instruments a separate module the play calls, marking unexercised code missed",
    async () => {
      const files = [`${fixtures}/counter-logic.showcase.ts`]
      const report = await Effect.runPromise(
        loadShowcasesFromFiles(files).pipe(
          Effect.flatMap((load) => collectCoverage(fixtures, files, load.showcases)),
          Effect.provide(platform),
        ),
      )

      // The play imports `lib/counter` and calls only `increment`; `decrement`
      // is never run, so the file is partially covered — real instrumentation of
      // the code the Showcase executed, across a file boundary.
      const counter = report.files.find((entry) => entry.path.endsWith("lib/counter.ts"))
      expect(counter).toBeDefined()
      const covered = counter?.coveredFunctions ?? 0
      const total = counter?.totalFunctions ?? 0
      expect(covered).toBeGreaterThan(0)
      expect(total).toBeGreaterThan(covered)
    },
    TIMEOUT_MS,
  )

  test(
    "names a showcase file the collector could not import, rather than dropping it",
    async () => {
      // The fixture imports a directory: Bun resolves it, Node does not. So the
      // one loader reads the Showcase and the run passes, while the collector
      // measures nothing — exactly the shape that used to print a warning above
      // a report that still read like a complete measurement.
      const files = [`${uncollectable}/dir-import.showcase.ts`]
      const report = await Effect.runPromise(
        loadShowcasesFromFiles(files).pipe(
          Effect.flatMap((load) => collectCoverage(uncollectable, files, load.showcases)),
          Effect.provide(platform),
        ),
      )

      expect(report.unmeasured.map((file) => file.path)).toEqual(files)
      expect(report.unmeasured[0]?.reason).toContain("ERR_UNSUPPORTED_DIR_IMPORT")

      const text = formatCoverage(report)
      expect(text).toContain("not measured:")
      expect(text).toContain("dir-import.showcase.ts")
      expect(text).toContain("1 not measured")
    },
    TIMEOUT_MS,
  )
})
