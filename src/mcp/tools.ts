import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Tool, Toolkit } from "effect/unstable/ai"


import { ShowcaseReport } from "../runner.js"
import {
  CatalogDirectoryError,
  CatalogListing,
  CatalogLoadReport,
  FoldcaseCatalog,
  type FoldcaseCatalogShape,
  NoMessageSchemaError,
  NoModelSchemaError,
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
 *
 * Every verb below carries the same three hints, because every verb reads the
 * declared catalog and writes nothing. Effect's unannotated defaults are the
 * opposite — `readOnlyHint: false`, `destructiveHint: true`,
 * `openWorldHint: true` — and an MCP host reads those hints when it decides
 * whether a call needs the user's confirmation, so leaving them unset makes
 * listing a catalog look like a destructive act on the open world.
 */
const ListShowcases = Tool.make("foldcase_list_showcases", {
  description:
    "List every Showcase in the catalog, with the directory they were read from, each flagged with whether it carries an introspectable Message schema and a Model schema. The entry point for driving Foldcase: enumerate, then foldcase_get_showcase_schema or foldcase_get_showcase_model_schema to learn a payload shape, then foldcase_run_showcase to assert its play.",
  success: CatalogListing,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

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
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

/**
 * Introspect a Showcase's Model Schema — what its `play` asserts on — into the
 * same document shape.
 *
 * A second verb rather than a parameter on the one above. That verb is
 * published: its name and description tell an agent it answers with the
 * Message-union schema, and a `part` parameter would leave
 * that description true only by default — the same call would answer with a
 * different document depending on an argument the tool list does not lead with.
 * A name is the cheapest thing to add and the most expensive thing to change,
 * so the Model gets its own. It also keeps each verb's failure exact
 * ({@link NoMessageSchemaError} against {@link NoModelSchemaError}), and the
 * listing's two flags say which of the two is worth calling.
 */
const GetShowcaseModelSchema = Tool.make("foldcase_get_showcase_model_schema", {
  description:
    "Introspect a Showcase's Model Effect Schema into a JSON Schema document (draft-2020-12 { dialect, schema, definitions }) — the peer of foldcase_get_showcase_schema, which answers with the Message union. The Model is the state a play asserts on, so read it before writing or repairing an assertion, or before reading a Model out of the live runtime with the foldkit-devtools MCP. Fails if the id is unknown or the Showcase declares no Model schema; foldcase_list_showcases flags which ones do.",
  parameters: ShowcaseIdInput,
  success: ShowcaseSchema,
  failure: Schema.Union([ShowcaseNotFoundError, NoModelSchemaError]),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

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
  // Read-only in the sense the MCP hint means: a `play` asserts on a pure
  // `update` and leaves no trace outside this process. It is also closed-world
  // — it can only reach the Showcases the catalog declares.
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

/** The `{ dir }` parameter of the one verb that moves the served catalog. */
class CatalogDirInput extends Schema.Class<CatalogDirInput>("CatalogDirInput")({
  dir: Schema.optional(
    Schema.String.annotate({
      description:
        "Directory to read, relative to the directory the server was started on (or absolute). Omit it to re-read the directory currently being served.",
    }),
  ),
}) {}

/**
 * Re-read the catalog, and point it at a directory.
 *
 * These are one verb because they are one act. The alternative was a `dir`
 * parameter on every id-addressed verb, and that makes an id mean nothing on
 * its own: the same id would name different Showcases from call to call, and
 * every call would pay for a directory walk and a fresh `import()` of every
 * module under it. So the directory is *state* — the server serves one catalog
 * at a time, this verb is the only thing that moves it, and every answer
 * carries the directory it came from, so an agent never has to guess which
 * catalog it is reading.
 */
const LoadCatalog = Tool.make("foldcase_load_catalog", {
  description:
    "Re-read the Showcase catalog from disk and report what came back: the directory read, how many Showcases it holds, and the files that would not load (with the reason). Call it after writing or deleting a Showcase file, so the catalog the other verbs answer from is the one on disk. Pass `dir` to serve another directory or subtree instead — it stays the served catalog until the next call. Fails only if the directory cannot be read. A module already imported is cached by the runtime, so an edit inside a file that has loaded needs a restart, not a reload.",
  parameters: CatalogDirInput,
  success: CatalogLoadReport,
  failure: CatalogDirectoryError,
})
  // Read-only in the sense the hint means: it reads a directory and writes
  // nothing. What it changes is this server's own view of it — the served
  // catalog — and that is not the caller's environment, so a host has no reason
  // to stop and ask.
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

/** The Foldcase catalog toolkit: the verbs the MCP server exposes. */
export const FoldcaseToolkit = Toolkit.make(
  ListShowcases,
  GetShowcaseSchema,
  GetShowcaseModelSchema,
  RunShowcase,
  LoadCatalog,
)

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
  foldcase_get_showcase_model_schema: (params: {
    readonly showcase_id: string
  }): Effect.Effect<ShowcaseSchema, ShowcaseNotFoundError | NoModelSchemaError> =>
    catalog.modelSchemaFor(params.showcase_id),
  foldcase_run_showcase: (params: {
    readonly showcase_id: string
  }): Effect.Effect<ShowcaseReport, ShowcaseNotFoundError> => catalog.runById(params.showcase_id),
  foldcase_load_catalog: (params: {
    readonly dir?: string | undefined
  }): Effect.Effect<CatalogLoadReport, CatalogDirectoryError> =>
    catalog.load(Option.fromNullishOr(params.dir)),
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
