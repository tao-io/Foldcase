import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Schema from "effect/Schema"

import { discoverShowcaseFiles, loadShowcasesFromFiles, type ShowcaseModuleError } from "../cli.js"
import { runShowcase, type Showcase, type ShowcaseReport } from "../runner.js"

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

/**
 * Discover every `*.showcase.ts` under `dir` and expose them as a catalog.
 * Composes the `foldcase test` discovery + module loader, so the MCP server
 * serves exactly the Showcases `foldcase test` runs. Fails
 * {@link ShowcaseModuleError} on a malformed catalog.
 */
export const loadCatalogFromDir = (
  dir: string,
): Effect.Effect<
  FoldcaseCatalogShape,
  ShowcaseModuleError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    // Resolve to an absolute dir first: discovered paths are dynamically
    // imported, and `import()` resolves a relative path against the importing
    // module, not the cwd, so a relative FOLDCASE_SHOWCASE_DIR would not load.
    const path = yield* Path.Path
    const files = yield* discoverShowcaseFiles(path.resolve(dir))
    const showcases = yield* loadShowcasesFromFiles(files)
    return makeCatalog(showcases)
  })

/** Config key for the directory the catalog server scans. Defaults to the cwd. */
const showcaseDir = Config.string("FOLDCASE_SHOWCASE_DIR").pipe(Config.withDefault("."))

/**
 * The catalog as an Effect service. `layer` reads the scan directory from
 * `Config` and loads it from disk; `layerFromShowcases` serves an in-memory set
 * (for tests and embedding).
 */
export class FoldcaseCatalog extends Context.Service<FoldcaseCatalog, FoldcaseCatalogShape>()(
  "foldcase/FoldcaseCatalog",
) {
  /** Live layer: scans `FOLDCASE_SHOWCASE_DIR` (default cwd) for `*.showcase.ts`. */
  static readonly layer: Layer.Layer<
    FoldcaseCatalog,
    ShowcaseModuleError | PlatformError | Config.ConfigError,
    FileSystem.FileSystem | Path.Path
  > = Layer.effect(FoldcaseCatalog)(showcaseDir.pipe(Effect.flatMap(loadCatalogFromDir)))

  /** Test/embed layer: serves a fixed set of Showcases with no disk access. */
  static readonly layerFromShowcases = (
    showcases: ReadonlyArray<Showcase>,
  ): Layer.Layer<FoldcaseCatalog> => Layer.succeed(FoldcaseCatalog)(makeCatalog(showcases))
}
