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
  readonly play: () => void
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
}) {}

/**
 * Boot a single Showcase headlessly, run its play, and report the outcome.
 * A failing Showcase is a datum (`status: "failed"` carrying the serialized
 * error), not an Effect failure — so the runner can collect a report per
 * Showcase without short-circuiting the suite.
 */
export const runShowcase = (showcase: Showcase): Effect.Effect<ShowcaseReport> =>
  Effect.try({ try: showcase.play, catch: serializeError }).pipe(
    Effect.match({
      onSuccess: () => new ShowcaseReport({ id: showcase.id, status: "passed" }),
      onFailure: (error) => new ShowcaseReport({ id: showcase.id, status: "failed", error }),
    }),
  )
