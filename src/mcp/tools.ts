import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Tool, Toolkit } from "effect/unstable/ai"

import { ShowcaseReport } from "../runner.js"
import {
  CatalogListing,
  FoldcaseCatalog,
  type FoldcaseCatalogShape,
  NoMessageSchemaError,
  ShowcaseNotFoundError,
  ShowcaseSchema,
} from "./catalog.js"

/** The `{ showcase_id }` parameter shared by the id-addressed catalog tools. */
class ShowcaseIdInput extends Schema.Class<ShowcaseIdInput>("ShowcaseIdInput")({
  showcase_id: Schema.String.annotate({
    description:
      "The Showcase id to act on, as returned by foldcase_list_showcases (e.g. 'sample/passes').",
  }),
}) {}

/**
 * Enumerate the Showcase catalog. The static, headless counterpart to
 * devtools-mcp's live `foldkit_list_runtimes`: it says *which* Showcases exist
 * (from the `*.showcase.ts` files) so an agent can pick one to inspect or run.
 */
const ListShowcases = Tool.make("foldcase_list_showcases", {
  description:
    "List every Showcase in the catalog, each flagged with whether it carries an introspectable Message schema. The entry point for driving Foldcase: enumerate, then foldcase_get_showcase_schema to learn a Message payload shape, then foldcase_run_showcase to assert its play.",
  success: CatalogListing,
})

/**
 * Introspect a Showcase's Message-union Schema into a JSON Schema document so an
 * agent constructs a valid typed payload by construction. The static catalog
 * peer of devtools-mcp's runtime `foldkit_get_message_schema` (which reads a
 * live runtime); this reads the Showcase's declared schema headlessly.
 */
const GetShowcaseSchema = Tool.make("foldcase_get_showcase_schema", {
  description:
    "Introspect a Showcase's Message-union Effect Schema into a JSON Schema document (draft-2020-12 { dialect, schema, definitions }). Use it to construct a valid Message object to dispatch into the live runtime via the foldkit-devtools MCP's foldkit_dispatch_message. Fails if the id is unknown or the Showcase declares no Message schema.",
  parameters: ShowcaseIdInput,
  success: ShowcaseSchema,
  failure: Schema.Union([ShowcaseNotFoundError, NoMessageSchemaError]),
})

/**
 * Run a Showcase's `play` headlessly and report the typed pass/fail. Composes
 * the `foldcase test` runner (runShowcase). A failing play is reported as
 * `status: "failed"` with the serialized error, not a tool error; only an
 * unknown id fails.
 */
const RunShowcase = Tool.make("foldcase_run_showcase", {
  description:
    "Run a Showcase's play headlessly and return the typed pass/fail report (a failing play is reported as status 'failed' with the serialized assertion error, not a tool error). This closes the self-healing loop: after dispatching a Message via the foldkit-devtools MCP, run the Showcase to assert the deterministic Model outcome. Fails only if the id is unknown.",
  parameters: ShowcaseIdInput,
  success: ShowcaseReport,
  failure: ShowcaseNotFoundError,
})

/** The Foldcase catalog toolkit: the three verbs the MCP server exposes. */
export const FoldcaseToolkit = Toolkit.make(ListShowcases, GetShowcaseSchema, RunShowcase)

/**
 * Bind the catalog verbs to a concrete {@link FoldcaseCatalogShape}. Kept a
 * plain function of the catalog so the tool→catalog wiring is `bun test`-able
 * without standing up the MCP transport.
 */
export const makeHandlers = (catalog: FoldcaseCatalogShape) => ({
  foldcase_list_showcases: (_params: Record<string, never>): Effect.Effect<CatalogListing> =>
    catalog.list,
  foldcase_get_showcase_schema: (params: {
    readonly showcase_id: string
  }): Effect.Effect<ShowcaseSchema, ShowcaseNotFoundError | NoMessageSchemaError> =>
    catalog.schemaFor(params.showcase_id),
  foldcase_run_showcase: (params: {
    readonly showcase_id: string
  }): Effect.Effect<ShowcaseReport, ShowcaseNotFoundError> => catalog.runById(params.showcase_id),
})

/**
 * The toolkit handlers as a Layer, resolving the catalog from the
 * {@link FoldcaseCatalog} service. Provided to `McpServer.toolkit(FoldcaseToolkit)`.
 */
export const FoldcaseHandlers = FoldcaseToolkit.toLayer(
  Effect.gen(function* () {
    const catalog = yield* FoldcaseCatalog
    return makeHandlers(catalog)
  }),
)
