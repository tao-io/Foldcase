import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import {
  type FileDetail,
  fileDetail,
  type RawCoverage,
  type ScriptHit,
  SkippedFile,
} from "./coverage.js"

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

/**
 * The whole coverage report: aggregate `files`, the per-Showcase breakdown, and
 * `unmeasured` — the showcase files the collector could not import at all.
 * Coverage never changes the run's exit code, so `unmeasured` is the only thing
 * standing between a truncated measurement and a reader who thinks it is whole.
 */
export class CoverageReport extends Schema.Class<CoverageReport>("foldcase/CoverageReport")({
  showcases: Schema.Array(ShowcaseCoverage),
  files: Schema.Array(FileCoverage),
  unmeasured: Schema.Array(SkippedFile),
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
 *
 * The breakdown is a projection of `showcases` — the declared {@link Showcase}
 * records (ADR-0001) — not of whatever ids the collector emitted: every declared
 * Showcase gets a row in declaration order, a Showcase the collector skipped
 * shows up with no files rather than vanishing, and an id the catalog does not
 * declare is dropped.
 */
export const buildCoverageReport = Effect.fn("foldcase.coverage.buildCoverageReport")(function* (
  raw: RawCoverage,
  showcases: ReadonlyArray<Showcase>,
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

  // The collector's attribution, looked up by the declared Showcase's id.
  const scriptsFor = (id: string): ReadonlyArray<ScriptHit> =>
    Option.match(
      Arr.findFirst(raw.showcases, (hit) => hit.id === id),
      { onNone: () => [], onSome: (hit) => hit.scripts },
    )

  return new CoverageReport({
    // Carried through untouched: the collector is the only thing that knows a
    // file would not import, and the report is the only place a reader looks.
    unmeasured: raw.skipped,
    files: aggregate.map((entry) => fileCoverageOf(entry.path, entry.detail, entry.detail)),
    showcases: showcases.map(
      (showcase) =>
        new ShowcaseCoverage({
          id: showcase.id,
          files: scriptsFor(showcase.id).map((script) => {
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
  // A declared Showcase the collector never reached has no files at all. Its
  // ratio would be 0/0, which `pct` reads as 100% — so say "not measured"
  // rather than print the one number that would be a lie.
  if (Arr.isReadonlyArrayEmpty(showcase.files)) {
    return `  ? ${showcase.id}  no coverage collected`
  }
  const ratio = sumLines(showcase.files)
  return `  ✓ ${showcase.id}  lines ${ratio.covered}/${ratio.executable} (${pct(ratio.covered, ratio.executable)}%)`
}

const formatUnmeasured = (file: SkippedFile): string => `  ${file.path} — ${file.reason}`

/** Render a coverage report as a human-readable summary (formatSuite style). */
export const formatCoverage = (report: CoverageReport): string => {
  const files = report.files.map(formatFile)
  const totalLines = overallLines(report)
  const totalFns = overallFunctions(report)
  // A file the collector could not import contributed nothing to the numbers
  // below, so the numbers below describe less than the run did. Say which files
  // and why, above the summary, and count them in the summary itself — a
  // truncated measurement that reads as a whole one is the defect.
  const unmeasured = Arr.isReadonlyArrayEmpty(report.unmeasured)
    ? []
    : ["", "not measured:", ...report.unmeasured.map(formatUnmeasured)]
  const dropped = Arr.isReadonlyArrayEmpty(report.unmeasured)
    ? ""
    : ` · ${report.unmeasured.length} not measured`
  const summary = `${report.files.length} file(s) · lines ${totalLines.covered}/${totalLines.executable} (${pct(totalLines.covered, totalLines.executable)}%) · fns ${totalFns.covered}/${totalFns.executable} (${pct(totalFns.covered, totalFns.executable)}%)${dropped}`
  // Per-Showcase attribution — the differentiator over a flat aggregate report.
  const perShowcase = Arr.isReadonlyArrayEmpty(report.showcases)
    ? []
    : ["", "by showcase:", ...report.showcases.map(formatShowcase)]
  return [...files, ...unmeasured, "", summary, ...perShowcase].join("\n")
}
