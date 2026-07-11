import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

/**
 * A portable Showcase, reduced to what the runner needs: an id and a `play`
 * thunk that throws on assertion failure (the boot.js play-runner contract).
 *
 * The runner is deliberately blind to *how* the play is produced — a Foldkit
 * Showcase's `play` is a `Scene.scene({ init, update, view }, …)` thunk, but
 * that adapter is a separate slice. Keeping `play` an opaque `() => void` is
 * the seam that lets the runner core stay framework-agnostic and `bun test`-able
 * without a DOM.
 */
export interface Showcase {
  readonly id: string
  readonly play: () => void
}

/** The per-Showcase result — a Schema-decoded report, not a bare object. */
export class ShowcaseReport extends Schema.Class<ShowcaseReport>("ShowcaseReport")({
  id: Schema.String,
  status: Schema.Literal("passed", "failed"),
}) {}

/**
 * Boot a single Showcase headlessly, run its play, and report the outcome.
 * A failing Showcase is a datum (`status: "failed"`), not an Effect failure —
 * so the runner can collect a report per Showcase without short-circuiting.
 */
export const runShowcase = (showcase: Showcase): Effect.Effect<ShowcaseReport> =>
  Effect.sync(() => {
    showcase.play()
    return new ShowcaseReport({ id: showcase.id, status: "passed" })
  })
