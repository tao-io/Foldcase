import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { runShowcase, type Showcase, type ShowcaseReport } from "../runner"

/** One entry in the catalog listing: a Showcase id and whether it carries a Message schema. */
export class ShowcaseSummary extends Schema.Class<ShowcaseSummary>("ShowcaseSummary")({
  id: Schema.String,
  hasMessageSchema: Schema.Boolean,
}) {}

/** The catalog listing — every discovered Showcase, in discovery order. */
export class CatalogListing extends Schema.Class<CatalogListing>("CatalogListing")({
  showcases: Schema.Array(ShowcaseSummary),
}) {}

/**
 * A Showcase's Message schema, introspected into a JSON Schema document (the
 * draft-2020-12 `{ dialect, schema, definitions }` shape from
 * `Schema.toJsonSchemaDocument`) so an agent can construct a valid typed
 * Message payload by construction.
 */
export class ShowcaseSchema extends Schema.Class<ShowcaseSchema>("ShowcaseSchema")({
  id: Schema.String,
  jsonSchema: Schema.Unknown,
}) {}

/** No Showcase in the catalog has the requested id. Carries the available ids. */
export class ShowcaseNotFoundError extends Schema.TaggedErrorClass<ShowcaseNotFoundError>()(
  "foldcase/ShowcaseNotFoundError",
  {
    id: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {}

/** The Showcase exists but declares no Message schema to introspect. */
export class NoMessageSchemaError extends Schema.TaggedErrorClass<NoMessageSchemaError>()(
  "foldcase/NoMessageSchemaError",
  {
    id: Schema.String,
  },
) {}

/** The read + run surface an MCP catalog server exposes over a set of Showcases. */
export interface FoldcaseCatalogShape {
  /** Enumerate every Showcase, flagging which carry an introspectable Message schema. */
  readonly list: Effect.Effect<CatalogListing>
  /**
   * Introspect a Showcase's Message schema into a JSON Schema document. Fails
   * {@link ShowcaseNotFoundError} for an unknown id, {@link NoMessageSchemaError}
   * when the Showcase declares no Message schema.
   */
  readonly schemaFor: (
    id: string,
  ) => Effect.Effect<ShowcaseSchema, ShowcaseNotFoundError | NoMessageSchemaError>
  /**
   * Run a Showcase's `play` and report the typed pass/fail. A failing play is a
   * datum (`ShowcaseReport { status: "failed" }`), not an Effect failure — only
   * an unknown id fails, with {@link ShowcaseNotFoundError}. This is the catalog
   * verb an agent calls after dispatching via devtools-mcp to assert the play.
   */
  readonly runById: (id: string) => Effect.Effect<ShowcaseReport, ShowcaseNotFoundError>
}

/**
 * Build the catalog surface over an in-memory set of Showcases. Pure and
 * synchronous to construct so it is trivially `bun test`-able; the wiring that
 * discovers `*.showcase.ts` from disk lives in the layer.
 */
export const makeCatalog = (showcases: ReadonlyArray<Showcase>): FoldcaseCatalogShape => {
  const availableIds = showcases.map((showcase) => showcase.id)

  const find = (id: string): Effect.Effect<Showcase, ShowcaseNotFoundError> =>
    Arr.findFirst(showcases, (showcase) => showcase.id === id).pipe(
      Option.match({
        onNone: () => Effect.fail(new ShowcaseNotFoundError({ id, available: availableIds })),
        onSome: Effect.succeed,
      }),
    )

  return {
    list: Effect.sync(
      () =>
        new CatalogListing({
          showcases: showcases.map(
            (showcase) =>
              new ShowcaseSummary({
                id: showcase.id,
                hasMessageSchema: showcase.message !== undefined,
              }),
          ),
        }),
    ),
    schemaFor: (id) =>
      find(id).pipe(
        Effect.flatMap((showcase) =>
          showcase.message === undefined
            ? Effect.fail(new NoMessageSchemaError({ id }))
            : Effect.succeed(
                new ShowcaseSchema({
                  id,
                  jsonSchema: Schema.toJsonSchemaDocument(showcase.message),
                }),
              ),
        ),
      ),
    runById: (id) => find(id).pipe(Effect.flatMap(runShowcase)),
  }
}
