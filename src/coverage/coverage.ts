import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"

// ─── The collector contract (V8 precise-coverage, per Showcase) ──────────────
//
// These schemas decode the JSON the Node coverage collector
// (`./collector.mjs`) prints to stdout. V8 precise coverage reports, per script,
// a flat list of functions; each function carries block `ranges` of
// `[startOffset, endOffset)` byte spans with an execution `count`. A count of 0
// on an inner range is a *hole* (that branch did not run) that overrides the
// covering outer range — the same nesting c8/istanbul reconstruct.

/** One executed (or un-executed) byte span within a function. */
export class RangeHit extends Schema.Class<RangeHit>("foldcase/RangeHit")({
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  count: Schema.Number,
}) {}

/** V8's per-function block coverage: the function's ranges (outer first). */
export class FunctionHit extends Schema.Class<FunctionHit>("foldcase/FunctionHit")({
  functionName: Schema.String,
  isBlockCoverage: Schema.Boolean,
  ranges: Schema.Array(RangeHit),
}) {}

/** Precise coverage for one script (source file), attributed to a Showcase. */
export class ScriptHit extends Schema.Class<ScriptHit>("foldcase/ScriptHit")({
  url: Schema.String,
  functions: Schema.Array(FunctionHit),
}) {}

// ─── Pure coverage math ──────────────────────────────────────────────────────

/** A file's line/function coverage tally — counts only, percentages derived. */
export interface FileTally {
  readonly coveredLines: number
  readonly executableLines: number
  readonly coveredFunctions: number
  readonly totalFunctions: number
}

// Per-offset coverage state while reconstructing block nesting.
const UNKNOWN = -1
const MISSED = 0
const COVERED = 1

// Outer-first: ascending start, then descending end, so a parent span is
// resolved before the child hole that must override it (the innermost range
// containing an offset is therefore the *last* one that contains it).
const outerFirst: Order.Order<RangeHit> = Order.combine(
  Order.mapInput(Order.Number, (range: RangeHit) => range.startOffset),
  Order.mapInput(Order.flip(Order.Number), (range: RangeHit) => range.endOffset),
)

/** The coverage mark of one source offset: covered, missed, or non-executable. */
const offsetMark = (ordered: ReadonlyArray<RangeHit>, offset: number): number => {
  const innermost = Arr.findLast(
    ordered,
    (range) => offset >= range.startOffset && offset < range.endOffset,
  )
  return Option.match(innermost, {
    onNone: () => UNKNOWN,
    onSome: (range) => (range.count > 0 ? COVERED : MISSED),
  })
}

// A source line's [start, end) offset span (end excludes the trailing newline).
interface LineSpan {
  readonly start: number
  readonly end: number
}

// Split the source into line spans, tracking each line's start offset. The
// trailing "" element after a final newline yields an empty span (no offsets),
// which classifies as non-executable and drops out of the denominator.
const lineSpans = (source: string): ReadonlyArray<LineSpan> =>
  Arr.mapAccum(source.split("\n"), 0, (offset, text) => [
    offset + text.length + 1,
    { start: offset, end: offset + text.length },
  ])[1]

/**
 * Reduce a file's V8 function coverage to line and function tallies.
 *
 * Line coverage uses the c8/istanbul reconstruction: flatten every function's
 * ranges, apply them outer-first (widest span first) so an inner count-0 hole
 * overrides the covering span, then classify each source line — covered if any
 * of its characters ran, executable if any character carried coverage info at
 * all (blank/structural gaps stay out of the denominator).
 *
 * Function coverage counts each V8 function whose own (outer) range ran.
 */
export const tallyFile = (source: string, functions: ReadonlyArray<FunctionHit>): FileTally => {
  const ordered = Arr.sort(
    functions.flatMap((fn) => fn.ranges),
    outerFirst,
  )
  const marks = Array.from({ length: source.length }, (_, offset) => offsetMark(ordered, offset))

  const lines = lineSpans(source).map((span) => {
    const lineMarks = marks.slice(span.start, span.end)
    return {
      executable: lineMarks.some((mark) => mark !== UNKNOWN),
      covered: lineMarks.some((mark) => mark === COVERED),
    }
  })

  const coveredFunctions = functions.filter((fn) => (fn.ranges[0]?.count ?? 0) > 0).length

  return {
    coveredLines: lines.filter((line) => line.executable && line.covered).length,
    executableLines: lines.filter((line) => line.executable).length,
    coveredFunctions,
    totalFunctions: functions.length,
  }
}
