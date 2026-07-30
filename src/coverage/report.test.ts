import { describe, expect, test } from "bun:test"
import { BunFileSystem } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"

import type { Showcase } from "../runner.js"
import { RawCoverage, ScriptHit } from "./coverage.js"
import { buildCoverageReport, CoverageReport, FileCoverage, formatCoverage, overallLines } from "./report.js"

/** A declared Showcase, reduced to what the coverage projection reads: its id. */
const showcase = (id: string): Showcase => ({ id, play: () => {} })

// Same deterministic three-line source as the tally unit test.
const SOURCE = "AAAA\nBBBB\nCCCC\n"

// Module wrapper + `f` ran (lines 1–2), `g` did not (line 3).
const functions = [
  { functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 15, count: 1 }] },
  { functionName: "f", isBlockCoverage: true, ranges: [{ startOffset: 5, endOffset: 10, count: 1 }] },
  { functionName: "g", isBlockCoverage: true, ranges: [{ startOffset: 10, endOffset: 15, count: 0 }] },
]

// Build a report over a scoped temp file holding SOURCE, run `use`, auto-clean.
// `declared` is the catalog the report is a projection of; `collected` are the
// ids the collector attributed coverage to (the same set, unless something was
// skipped).
const reportOverSource = <A>(
  use: (report: CoverageReport, path: string) => A,
  declared: ReadonlyArray<Showcase> = [showcase("demo/one")],
  collected: ReadonlyArray<string> = ["demo/one"],
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* fs.makeTempFileScoped()
      yield* fs.writeFileString(path, SOURCE)
      const raw = new RawCoverage({
        showcases: collected.map((id) => ({ id, scripts: [new ScriptHit({ path, functions })] })),
        total: [new ScriptHit({ path, functions })],
      })
      const report = yield* buildCoverageReport(raw, declared)
      return use(report, path)
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)),
  )

describe("buildCoverageReport", () => {
  test("reads sources and tallies aggregate + per-Showcase file coverage", async () => {
    await reportOverSource((report, path) => {
      expect(report.files).toHaveLength(1)
      const file = report.files[0]
      expect(file?.path).toBe(path)
      expect(file?.coveredLines).toBe(2)
      expect(file?.executableLines).toBe(3)
      expect(file?.coveredFunctions).toBe(2)
      expect(file?.totalFunctions).toBe(3)

      expect(report.showcases).toHaveLength(1)
      const showcase = report.showcases[0]
      expect(showcase?.id).toBe("demo/one")
      expect(showcase?.files[0]?.coveredLines).toBe(2)
    })
  })

  test("projects the declared catalog: a Showcase with no collected coverage still appears", async () => {
    await reportOverSource(
      (report) => {
        // ADR-0001: the breakdown is a projection of the `Showcase` records, in
        // declaration order — not of whatever ids the collector happened to
        // emit. A file the collector skipped is a visible gap, not a silent one.
        expect(report.showcases.map((entry) => entry.id)).toEqual(["demo/one", "demo/skipped"])
        expect(report.showcases[1]?.files).toEqual([])
      },
      [showcase("demo/one"), showcase("demo/skipped")],
      ["demo/one"],
    )
  })

  test("drops attribution for an id the catalog does not declare", async () => {
    await reportOverSource(
      (report) => {
        expect(report.showcases.map((entry) => entry.id)).toEqual(["demo/one"])
      },
      [showcase("demo/one")],
      ["demo/one", "demo/ghost"],
    )
  })
})

describe("overallLines / formatCoverage", () => {
  test("overallLines sums covered vs executable across files", () => {
    const report = new CoverageReport({
      showcases: [],
      files: [
        new FileCoverage({ path: "/a.ts", coveredLines: 2, executableLines: 3, coveredFunctions: 2, totalFunctions: 3 }),
        new FileCoverage({ path: "/b.ts", coveredLines: 1, executableLines: 4, coveredFunctions: 1, totalFunctions: 2 }),
      ],
    })
    expect(overallLines(report)).toEqual({ covered: 3, executable: 7 })
  })

  test("formatCoverage renders a per-file summary with percentages", async () => {
    await reportOverSource((report) => {
      const text = formatCoverage(report)
      expect(text).toContain("lines")
      expect(text).toContain("67%") // 2/3 lines
      expect(text).toContain("1 file")
      // Per-Showcase attribution is visible, not just the aggregate.
      expect(text).toContain("demo/one")
    })
  })

  test("formatCoverage says so when a declared Showcase collected nothing", async () => {
    await reportOverSource(
      (report) => {
        // 0/0 would render as 100% — the one number that must never stand for
        // "not measured".
        expect(formatCoverage(report)).toContain("demo/skipped  no coverage collected")
      },
      [showcase("demo/one"), showcase("demo/skipped")],
      ["demo/one"],
    )
  })
})
