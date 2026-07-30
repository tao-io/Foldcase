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

const coveredFns = (detail: FileDetail): number => detail.functions.filter((fn) => fn.covered).length

// A file row: line/function *numerators* from `covered` (what ran), *denominators*
// from `denom` (the file's total executable lines / functions). For the aggregate
// both are the cumulative snapshot; for a Showcase, `covered` is its own delta.
const fileCoverageOf = (path: string, covered: FileDetail, denom: FileDetail): FileCoverage =>
  new FileCoverage({
    path,
    coveredLines: covered.coveredLines.length,
    executableLines: denom.executableLines.length,
    coveredFunctions: coveredFns(covered),
    totalFunctions: denom.functions.length,
  })

/**
 * Turn decoded collector output into a {@link CoverageReport}: read each unique
 * source once, then tally the cumulative `total` into the aggregate `files`, and
 * each Showcase's per-`play` delta into a breakdown whose denominators come from
 * that aggregate (so a Showcase reads as "covered X of the file's Y lines").
 * Fails only if a covered source can't be read (caller treats it best-effort).
 */
export const buildCoverageReport = Effect.fn("foldcase.coverage.buildCoverageReport")(function* (
  raw: RawCoverage,
) {
  const fs = yield* FileSystem.FileSystem
  const allScripts = [...raw.total, ...raw.showcases.flatMap((showcase) => showcase.scripts)]
  const paths = Arr.dedupe(allScripts.map((script) => script.path))
  const sources = yield* Effect.forEach(
    paths,
    (path) => fs.readFileString(path).pipe(Effect.map((source) => ({ path, source }))),
    { concurrency: "unbounded" },
  )
  const detailOf = (script: ScriptHit): FileDetail =>
    fileDetail(sourceOf(sources, script.path), script.functions)

  // The cumulative per-file denominators, indexed by path.
  const aggregate = raw.total.map((script) => ({ path: script.path, detail: detailOf(script) }))
  const denomFor = (path: string, fallback: FileDetail): FileDetail =>
    Option.match(
      Arr.findFirst(aggregate, (entry) => entry.path === path),
      { onNone: () => fallback, onSome: (entry) => entry.detail },
    )

  return new CoverageReport({
    files: aggregate.map((entry) => fileCoverageOf(entry.path, entry.detail, entry.detail)),
    showcases: raw.showcases.map(
      (showcase) =>
        new ShowcaseCoverage({
          id: showcase.id,
          files: showcase.scripts.map((script) => {
            const covered = detailOf(script)
            return fileCoverageOf(script.path, covered, denomFor(script.path, covered))
          }),
        }),
    ),
  })
})

// ─── Reporting ───────────────────────────────────────────────────────────────

interface Ratio {
  readonly covered: number
  readonly executable: number
}

const sumLines = (files: ReadonlyArray<FileCoverage>): Ratio =>
  files.reduce<Ratio>(
    (acc, file) => ({
      covered: acc.covered + file.coveredLines,
      executable: acc.executable + file.executableLines,
    }),
    { covered: 0, executable: 0 },
  )

/** Sum covered vs executable lines across every file in the report. */
export const overallLines = (report: CoverageReport): Ratio => sumLines(report.files)

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

const formatShowcase = (showcase: ShowcaseCoverage): string => {
  const ratio = sumLines(showcase.files)
  return `  ✓ ${showcase.id}  lines ${ratio.covered}/${ratio.executable} (${pct(ratio.covered, ratio.executable)}%)`
}

/** Render a coverage report as a human-readable summary (formatSuite style). */
export const formatCoverage = (report: CoverageReport): string => {
  const files = report.files.map(formatFile)
  const totalLines = overallLines(report)
  const totalFns = overallFunctions(report)
  const summary = `${report.files.length} file(s) · lines ${totalLines.covered}/${totalLines.executable} (${pct(totalLines.covered, totalLines.executable)}%) · fns ${totalFns.covered}/${totalFns.executable} (${pct(totalFns.covered, totalFns.executable)}%)`
  // Per-Showcase attribution — the differentiator over a flat aggregate report.
  const perShowcase = Arr.isReadonlyArrayEmpty(report.showcases)
    ? []
    : ["", "by showcase:", ...report.showcases.map(formatShowcase)]
  return [...files, "", summary, ...perShowcase].join("\n")
}
