import * as Effect from "effect/Effect"
import * as P from "effect/Predicate"
import * as Schema from "effect/Schema"

/**
 * A portable Showcase, reduced to what the runner needs: an id and a `play`
 * thunk that throws on assertion failure (the boot.js play-runner contract).
 *
 * The runner is deliberately blind to *how* the play is produced — a Foldkit
 * Showcase's `play` is a `Story.story({ update }, …)` thunk asserting on the
 * Model, but that content lives in the app's own (DOM-capable) closure. Keeping
 * `play` an opaque `() => void` is the seam that lets the runner core stay
 * framework-agnostic and `bun test`-able without a DOM.
 */
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void>
  /**
   * Optional Message-union Schema for the component under showcase. When
   * present, the `foldcase mcp` catalog server introspects it into a JSON
   * Schema so an agent can construct a valid typed Message by construction
   * (the static, per-Showcase counterpart to devtools-mcp's runtime
   * `foldkit_get_message_schema`). Absent for framework-agnostic showcases.
   */
  readonly message?: Schema.Top
  /**
   * Optional Model Schema for the component under showcase. When present, the
   * `foldcase docs` generator introspects it into a Model Schema table (the
   * static peer of `message`). Mirrors the `message` seam — optional and
   * backward-compatible; absent for framework-agnostic showcases.
   */
  readonly model?: Schema.Top
}

/**
 * A structurally-serialized error, mirroring the fork's boot protocol
 * (`packages/openstory/src/boot/protocol.ts` `SerializedError`) so a foldcase
 * report and a boot.js `play-status` describe a failure the same way.
 */
export class SerializedError extends Schema.Class<SerializedError>("SerializedError")({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  docsUrl: Schema.optional(Schema.String),
}) {}

// This is a boundary error-normalizer for the arbitrary value an opaque `play`
// thunk throws (a native Error from a Foldkit Story assertion), not domain
// Effect error handling. It mirrors the fork's `serializeError`. `instanceof
// Error` and `string | undefined` are the right shape here — the report fields
// are `Schema.optional(Schema.String)`, so absence is `undefined`, and Effect's
// tagged-error discrimination does not apply to a caught unknown.
// oxlint-disable-next-line effect/prefer-option-over-null -- boundary normalizer; the report fields are Schema.optional strings, so absence is `undefined`, see note above.
const readStringProperty = (value: object, propertyName: string): string | undefined => {
  const candidate = Reflect.get(value, propertyName)
  return P.isString(candidate) ? candidate : undefined
}

/** Reduce an unknown thrown value to a {@link SerializedError}. */
export const serializeError = (error: unknown): SerializedError => {
  // oxlint-disable-next-line effect/avoid-untagged-errors -- boundary normalizer for a caught unknown, see note above.
  if (error instanceof Error) {
    return new SerializedError({
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: readStringProperty(error, "code"),
      docsUrl: readStringProperty(error, "docsUrl"),
    })
  }
  return new SerializedError({ name: "Error", message: String(error) })
}

/** The per-Showcase result — a Schema-decoded report, not a bare object. */
export class ShowcaseReport extends Schema.Class<ShowcaseReport>("ShowcaseReport")({
  id: Schema.String,
  status: Schema.Literals(["passed", "failed"]),
  error: Schema.optional(SerializedError),
  /**
   * The `*.showcase.ts` this report came from, when the caller knows it. An id
   * alone does not say which file to open, and the loader — not the author —
   * holds that fact, so it is passed in rather than read off the record.
   * Optional: a caller holding a bare Showcase, such as the MCP `runById` verb,
   * has no file to name.
   */
  file: Schema.optional(Schema.String),
}) {}

/**
 * Boot a single Showcase headlessly, run its play, and report the outcome.
 * A failing Showcase is a datum (`status: "failed"` carrying the serialized
 * error), not an Effect failure — so the runner can collect a report per
 * Showcase without short-circuiting the suite. `file` names the module the
 * Showcase was read from, so a report says where to look.
 */
export const runShowcase = (showcase: Showcase, file?: string): Effect.Effect<ShowcaseReport> =>
  Effect.tryPromise({
    // The async wrapper normalizes both a synchronous throw and a rejected
    // Promise from `play` into a single failure the catch can serialize.
    try: async () => {
      await showcase.play()
    },
    catch: serializeError,
  }).pipe(
    Effect.match({
      onSuccess: () => new ShowcaseReport({ id: showcase.id, status: "passed", file }),
      onFailure: (error) => new ShowcaseReport({ id: showcase.id, status: "failed", error, file }),
    }),
  )

/** The whole-suite result — per-Showcase reports plus rolled-up counts. */
export class SuiteReport extends Schema.Class<SuiteReport>("SuiteReport")({
  total: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  reports: Schema.Array(ShowcaseReport),
}) {}

/**
 * Roll a set of per-Showcase reports into one {@link SuiteReport}, in the order
 * given. Kept separate from {@link runShowcases} because not every report comes
 * from a `play`: a `*.showcase.ts` that would not load is reported for the file
 * itself, and it belongs in the same suite verdict.
 */
export const suiteOf = (reports: ReadonlyArray<ShowcaseReport>): SuiteReport => {
  const passed = reports.filter((report) => report.status === "passed").length
  return new SuiteReport({
    total: reports.length,
    passed,
    failed: reports.length - passed,
    reports,
  })
}

/**
 * Run every Showcase and roll the results into one {@link SuiteReport}.
 * Runs sequentially so report order matches input order, and never
 * short-circuits — a failing Showcase is recorded, not thrown.
 */
export const runShowcases = (showcases: ReadonlyArray<Showcase>): Effect.Effect<SuiteReport> =>
  // One argument on purpose: `forEach` hands the callback an index, and
  // `runShowcase` reads a second argument as the file the Showcase came from.
  Effect.forEach(showcases, (showcase) => runShowcase(showcase), { concurrency: 1 }).pipe(
    Effect.map(suiteOf),
  )

// REPORTING

/** Process exit code for a suite: 0 when everything passed, 1 on any failure. */
export const suiteExitCode = (suite: SuiteReport): 0 | 1 => (suite.failed > 0 ? 1 : 0)

const formatReport = (report: ShowcaseReport): string => {
  if (report.status === "passed") {
    return `  ✓ ${report.id}`
  }
  const reason = report.error === undefined ? "failed" : report.error.message
  return `  ✗ ${report.id} — ${reason}`
}

/** Render a suite as a human-readable summary for the CLI. */
export const formatSuite = (suite: SuiteReport): string => {
  const lines = suite.reports.map(formatReport)
  const summary = `${suite.total} total · ${suite.passed} passed · ${suite.failed} failed`
  return [...lines, "", summary].join("\n")
}
