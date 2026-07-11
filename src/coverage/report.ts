import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { type FileDetail, fileDetail, type RawCoverage, type ScriptHit } from "./coverage"

// ─── The emitted coverage report ─────────────────────────────────────────────

/** Line/function coverage for one source file (counts; percentages derived). */
export class FileCoverage extends Schema.Class<FileCoverage>("foldcase/FileCoverage")({
  path: Schema.String,
  coveredLines: Schema.Number,
  executableLines: Schema.Number,
  coveredFunctions: Schema.Number,
  totalFunctions: Schema.Number,
}) {}

/** Coverage attributed to a single Showcase's `play` (its executed files). */
export class ShowcaseCoverage extends Schema.Class<ShowcaseCoverage>("foldcase/ShowcaseCoverage")({
  id: Schema.String,
  files: Schema.Array(FileCoverage),
}) {}

/** The whole coverage report: aggregate `files` plus per-Showcase breakdown. */
export class CoverageReport extends Schema.Class<CoverageReport>("foldcase/CoverageReport")({
  showcases: Schema.Array(ShowcaseCoverage),
  files: Schema.Array(FileCoverage),
}) {}

// ─── Building the report from decoded collector output ───────────────────────

interface SourceFile {
  readonly path: string
  readonly source: string
}

const sourceOf = (sources: ReadonlyArray<SourceFile>, path: string): string =>
  Option.match(
    Arr.findFirst(sources, (entry) => entry.path === path),
    { onNone: () => "", onSome: (entry) => entry.source },
  )

const fileCoverageOf = (path: string, detail: FileDetail): FileCoverage =>
  new FileCoverage({
    path,
    coveredLines: detail.coveredLines.length,
    executableLines: detail.executableLines.length,
    coveredFunctions: detail.functions.filter((fn) => fn.covered).length,
    totalFunctions: detail.functions.length,
  })

// Union many per-Showcase details for the same file: a line/function counts as
// covered if it ran in *any* Showcase; the denominators are the union of what
// each run saw (line numbers and function keys are the identities).
const unionDetail = (details: ReadonlyArray<FileDetail>): FileDetail => ({
  executableLines: Arr.dedupe(details.flatMap((detail) => detail.executableLines)),
  coveredLines: Arr.dedupe(details.flatMap((detail) => detail.coveredLines)),
  functions: Arr.dedupeWith(
    details.flatMap((detail) => detail.functions),
    (a, b) => a.key === b.key,
  ).map((fn) => ({
    key: fn.key,
    covered: details.some((detail) => detail.functions.some((g) => g.key === fn.key && g.covered)),
  })),
})

/**
 * Turn decoded collector output into a {@link CoverageReport}: read each unique
 * source once, tally every Showcase's per-`play` coverage, then union those per
 * file into the aggregate `files`. Fails only if a covered source file can't be
 * read (the caller treats coverage as best-effort).
 */
export const buildCoverageReport = Effect.fn("foldcase.coverage.buildCoverageReport")(function* (
  raw: RawCoverage,
) {
  const fs = yield* FileSystem.FileSystem
  const scripts = raw.showcases.flatMap((showcase) => showcase.scripts)
  const paths = Arr.dedupe(scripts.map((script) => script.path))
  const sources = yield* Effect.forEach(
    paths,
    (path) => fs.readFileString(path).pipe(Effect.map((source) => ({ path, source }))),
    { concurrency: "unbounded" },
  )
  const detailOf = (script: ScriptHit): FileDetail =>
    fileDetail(sourceOf(sources, script.path), script.functions)

  return new CoverageReport({
    files: paths.map((path) =>
      fileCoverageOf(
        path,
        unionDetail(scripts.filter((script) => script.path === path).map(detailOf)),
      ),
    ),
    showcases: raw.showcases.map(
      (showcase) =>
        new ShowcaseCoverage({
          id: showcase.id,
          files: showcase.scripts.map((script) => fileCoverageOf(script.path, detailOf(script))),
        }),
    ),
  })
})

// ─── Reporting ───────────────────────────────────────────────────────────────

interface Ratio {
  readonly covered: number
  readonly executable: number
}

/** Sum covered vs executable lines across every file in the report. */
export const overallLines = (report: CoverageReport): Ratio =>
  report.files.reduce<Ratio>(
    (acc, file) => ({
      covered: acc.covered + file.coveredLines,
      executable: acc.executable + file.executableLines,
    }),
    { covered: 0, executable: 0 },
  )

/** Sum covered vs total functions across every file in the report. */
export const overallFunctions = (report: CoverageReport): Ratio =>
  report.files.reduce<Ratio>(
    (acc, file) => ({
      covered: acc.covered + file.coveredFunctions,
      executable: acc.executable + file.totalFunctions,
    }),
    { covered: 0, executable: 0 },
  )

// A whole percentage; an empty denominator reads as fully covered (nothing to miss).
const pct = (covered: number, total: number): number =>
  total === 0 ? 100 : Math.round((covered / total) * 100)

const formatFile = (file: FileCoverage): string =>
  `  ${file.path}  lines ${file.coveredLines}/${file.executableLines} (${pct(file.coveredLines, file.executableLines)}%)  fns ${file.coveredFunctions}/${file.totalFunctions} (${pct(file.coveredFunctions, file.totalFunctions)}%)`

/** Render a coverage report as a human-readable summary (formatSuite style). */
export const formatCoverage = (report: CoverageReport): string => {
  const lines = report.files.map(formatFile)
  const totalLines = overallLines(report)
  const totalFns = overallFunctions(report)
  const summary = `${report.files.length} file(s) · lines ${totalLines.covered}/${totalLines.executable} (${pct(totalLines.covered, totalLines.executable)}%) · fns ${totalFns.covered}/${totalFns.executable} (${pct(totalFns.covered, totalFns.executable)}%)`
  return [...lines, "", summary].join("\n")
}
