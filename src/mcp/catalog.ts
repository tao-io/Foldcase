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
import * as SynchronizedRef from "effect/SynchronizedRef"

import {
  discoverShowcaseFiles,
  loadShowcasesFromFiles,
  ShowcaseModuleError,
} from "../cli.js"
import { runShowcase, type Showcase, type ShowcaseReport } from "../runner.js"

/** One entry in the catalog listing: a Showcase id and whether it carries a Message schema. */
export class ShowcaseSummary extends Schema.Class<ShowcaseSummary>("ShowcaseSummary")({
  id: Schema.String,
  hasMessageSchema: Schema.Boolean,
}) {}

/**
 * The catalog listing — every discovered Showcase, in discovery order, and the
 * directory they were read from. The directory is absent only for a catalog
 * served from memory (tests, embedding), which no directory backs.
 */
export class CatalogListing extends Schema.Class<CatalogListing>("CatalogListing")({
  dir: Schema.optional(Schema.String),
  showcases: Schema.Array(ShowcaseSummary),
}) {}

/**
 * What one load produced: the directory read, how many Showcases came out of
 * it, and the files that would not load at all. The count is the answer to
 * "did my edit land"; the failures are the ones an agent has to go and fix.
 */
export class CatalogLoadReport extends Schema.Class<CatalogLoadReport>("CatalogLoadReport")({
  dir: Schema.optional(Schema.String),
  showcaseCount: Schema.Number,
  failures: Schema.Array(ShowcaseModuleError),
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

/** The directory a load named cannot be read. Carries the path and the reason. */
export class CatalogDirectoryError extends Schema.TaggedErrorClass<CatalogDirectoryError>()(
  "foldcase/CatalogDirectoryError",
  {
    dir: Schema.String,
    reason: Schema.String,
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
  /**
   * Re-read the catalog from disk and report what came back. With no directory
   * it refreshes the one being served — the verb an agent calls after editing a
   * Showcase. With one, that directory becomes the catalog every other verb
   * answers from, so a call can narrow the server to a subtree. A load that
   * fails leaves the last good catalog in place.
   */
  readonly load: (
    dir: Option.Option<string>,
  ) => Effect.Effect<CatalogLoadReport, CatalogDirectoryError>
}

/**
 * One pass of the loader, as the catalog holds it: the directory it read, the
 * Showcases in it, and the files it could not read. The directory is `None`
 * only for a catalog served from memory.
 */
interface CatalogState {
  readonly dir: Option.Option<string>
  readonly showcases: ReadonlyArray<Showcase>
  readonly failures: ReadonlyArray<ShowcaseModuleError>
}

/**
 * How a catalog reads its next state. `requested` is the directory the call
 * named and `current` the one being served, so a call that names none refreshes
 * what is already there.
 */
type CatalogReader = (
  requested: Option.Option<string>,
  current: Option.Option<string>,
) => Effect.Effect<CatalogState, CatalogDirectoryError>

const reportOf = (state: CatalogState): CatalogLoadReport =>
  new CatalogLoadReport({
    dir: Option.getOrUndefined(state.dir),
    showcaseCount: state.showcases.length,
    failures: state.failures,
  })

/**
 * Build the catalog surface over a first state and a reader for the next one.
 *
 * The served catalog is *state*: `load` replaces it. It lives in a
 * `SynchronizedRef` so the effectful swap is serialised — two reloads cannot
 * interleave, and a reload that fails leaves the last good catalog in place.
 */
const makeCatalogWith = (
  initial: CatalogState,
  read: CatalogReader,
): Effect.Effect<FoldcaseCatalogShape> =>
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make(initial)

    const find = (id: string): Effect.Effect<Showcase, ShowcaseNotFoundError> =>
      SynchronizedRef.get(state).pipe(
        Effect.flatMap((current) =>
          Arr.findFirst(current.showcases, (showcase) => showcase.id === id).pipe(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new ShowcaseNotFoundError({
                    id,
                    available: current.showcases.map((showcase) => showcase.id),
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )

    return {
      list: SynchronizedRef.get(state).pipe(
        Effect.map(
          (current) =>
            new CatalogListing({
              dir: Option.getOrUndefined(current.dir),
              showcases: current.showcases.map(
                (showcase) =>
                  new ShowcaseSummary({
                    id: showcase.id,
                    hasMessageSchema: showcase.message !== undefined,
                  }),
              ),
            }),
        ),
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
      load: (dir) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          read(dir, current.dir).pipe(Effect.map((next) => [reportOf(next), next] as const)),
        ),
    }
  })

/**
 * Build the catalog surface over an in-memory set of Showcases — the shape
 * tests and embedders use, with no disk behind it. Nothing backs it, so `load`
 * re-serves what it already holds rather than reading a directory.
 */
export const makeCatalog = (
  showcases: ReadonlyArray<Showcase>,
): Effect.Effect<FoldcaseCatalogShape> => {
  const state: CatalogState = { dir: Option.none(), failures: [], showcases }
  return makeCatalogWith(state, () => Effect.succeed(state))
}

/**
 * Read one directory into a catalog state: discover every showcase file under
 * it, load them, and say which would not load.
 *
 * A file that would not load is logged (to stderr, where the server's logs go)
 * and the rest are still served: an agent losing the whole catalog because one
 * module has a bad import is worse than an agent losing that module.
 */
const readCatalogDir = (
  dir: string,
): Effect.Effect<CatalogState, CatalogDirectoryError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const files = yield* discoverShowcaseFiles(dir).pipe(
      // The only way a directory walk fails is the platform's, and it is the
      // one thing here that is a typed failure rather than data: an agent that
      // named a directory which is not there has to read why. Normalise the
      // platform error once, at this boundary, into the error the tool declares.
      Effect.mapError(
        (cause: PlatformError) => new CatalogDirectoryError({ dir, reason: cause.message }),
      ),
    )
    const load = yield* loadShowcasesFromFiles(files)
    yield* Effect.forEach(
      load.failures,
      (failure) => Effect.logWarning(`foldcase mcp: ${failure.message}`),
      { concurrency: 1, discard: true },
    )
    return { dir: Option.some(dir), failures: load.failures, showcases: load.showcases }
  })

/**
 * Discover every showcase file under `dir` and expose them as a catalog.
 * Composes the `foldcase test` discovery + module loader, so the MCP server
 * serves exactly the Showcases `foldcase test` runs.
 *
 * `dir` is the server's root: it anchors every later load, and the catalog
 * starts on it.
 */
export const loadCatalogFromDir = (
  dir: string,
): Effect.Effect<
  FoldcaseCatalogShape,
  CatalogDirectoryError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    // Resolve to an absolute dir first: discovered paths are dynamically
    // imported, and `import()` resolves a relative path against the importing
    // module, not the cwd, so a relative FOLDCASE_SHOWCASE_DIR would not load.
    const path = yield* Path.Path
    const root = path.resolve(dir)
    // The reader outlives this Effect — every later load re-runs it, from a
    // tool call — so it carries the platform services rather than asking the
    // caller's context for them again.
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
    const read: CatalogReader = (requested, current) =>
      readCatalogDir(
        Option.match(requested, {
          onNone: () => Option.getOrElse(current, () => root),
          // A relative directory resolves against the root the server started
          // on, never against the one being served: two identical calls then
          // mean the same thing, and no run of them can walk away from the root.
          onSome: (target) => path.resolve(root, target),
        }),
      ).pipe(Effect.provideContext(services))
    const initial = yield* read(Option.none(), Option.none())
    return yield* makeCatalogWith(initial, read)
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
  /** Live layer: scans `FOLDCASE_SHOWCASE_DIR` (default cwd) for showcase files. */
  static readonly layer: Layer.Layer<
    FoldcaseCatalog,
    CatalogDirectoryError | Config.ConfigError,
    FileSystem.FileSystem | Path.Path
  > = Layer.effect(FoldcaseCatalog)(showcaseDir.pipe(Effect.flatMap(loadCatalogFromDir)))

  /** Test/embed layer: serves a fixed set of Showcases with no disk access. */
  static readonly layerFromShowcases = (
    showcases: ReadonlyArray<Showcase>,
  ): Layer.Layer<FoldcaseCatalog> => Layer.effect(FoldcaseCatalog)(makeCatalog(showcases))
}
