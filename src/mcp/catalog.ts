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
import type { ChildProcessSpawner } from "effect/unstable/process"

import {
  type CatalogLoad,
  discoverShowcaseFiles,
  type LoadedShowcase,
  loadShowcasesFromFiles,
  ShowcaseModuleError,
} from "../cli.js"
import {
  SerializedError,
  type Showcase,
  ShowcaseReport,
  type SuiteReport,
  suiteOf,
} from "../runner.js"
import {
  type FreshRunDocument,
  FreshRunError,
  FreshSelection,
  runSelection,
  spawnFreshRun,
} from "./freshRun.js"

/**
 * One entry in the catalog listing: a Showcase id and which Schemas it carries.
 * The two flags are read separately — a Showcase declares either, both or
 * neither — and each says which introspection verb is worth calling.
 */
export class ShowcaseSummary extends Schema.Class<ShowcaseSummary>("ShowcaseSummary")({
  id: Schema.String,
  hasMessageSchema: Schema.Boolean,
  hasModelSchema: Schema.Boolean,
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

// Every error below renders its payload as its `message`. A schema-backed error
// keeps its payload in fields, so the `message` it inherits is empty — and an
// MCP host answers a declared tool failure with exactly that string. Without
// these getters an agent is told a call failed and nothing else, which is the
// one thing the payloads exist to prevent. `ShowcaseModuleError` in `src/cli.ts`
// does the same, for the same reason.

/** No Showcase in the catalog has the requested id. Carries the available ids. */
export class ShowcaseNotFoundError extends Schema.TaggedErrorClass<ShowcaseNotFoundError>()(
  "foldcase/ShowcaseNotFoundError",
  {
    id: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `no Showcase with id ${JSON.stringify(this.id)}; available: ${this.available.join(", ")}`
  }
}

/** The Showcase exists but declares no Message schema to introspect. */
export class NoMessageSchemaError extends Schema.TaggedErrorClass<NoMessageSchemaError>()(
  "foldcase/NoMessageSchemaError",
  {
    id: Schema.String,
  },
) {
  override get message(): string {
    return `Showcase ${JSON.stringify(this.id)} declares no Message schema`
  }
}

/** The Showcase exists but declares no Model schema to introspect. */
export class NoModelSchemaError extends Schema.TaggedErrorClass<NoModelSchemaError>()(
  "foldcase/NoModelSchemaError",
  {
    id: Schema.String,
  },
) {
  override get message(): string {
    return `Showcase ${JSON.stringify(this.id)} declares no Model schema`
  }
}

/** No Showcase id starts with the requested prefix. Carries the available ids. */
export class NoShowcaseMatchedError extends Schema.TaggedErrorClass<NoShowcaseMatchedError>()(
  "foldcase/NoShowcaseMatchedError",
  {
    prefix: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `no Showcase id starts with ${JSON.stringify(this.prefix)}; available: ${this.available.join(", ")}`
  }
}

/** The directory a load named cannot be read. Carries the path and the reason. */
export class CatalogDirectoryError extends Schema.TaggedErrorClass<CatalogDirectoryError>()(
  "foldcase/CatalogDirectoryError",
  {
    dir: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.dir}: ${this.reason}`
  }
}

/** The read + run surface an MCP catalog server exposes over a set of Showcases. */
export interface FoldcaseCatalogShape {
  /** Enumerate every Showcase, flagging which Schemas each one carries. */
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
   * Introspect a Showcase's Model schema into the same document shape. Fails
   * {@link ShowcaseNotFoundError} for an unknown id, {@link NoModelSchemaError}
   * when the Showcase declares no Model schema. This is what a `play` asserts
   * on, so it is what an agent has to know the shape of before it writes one.
   */
  readonly modelSchemaFor: (
    id: string,
  ) => Effect.Effect<ShowcaseSchema, ShowcaseNotFoundError | NoModelSchemaError>
  /**
   * Run a Showcase's `play` and report the typed pass/fail. A failing play is a
   * datum (`ShowcaseReport { status: "failed" }`), not an Effect failure — only
   * an unknown id fails, with {@link ShowcaseNotFoundError}. This is the catalog
   * verb an agent calls after dispatching via devtools-mcp to assert the play.
   *
   * A catalog read from a directory runs it in a fresh child process, so the
   * play that runs is the one on disk — not the module this process imported
   * before the agent's last edit.
   */
  readonly runById: (id: string) => Effect.Effect<ShowcaseReport, ShowcaseNotFoundError>
  /**
   * Run the whole catalog into one {@link SuiteReport}, or the part of it under
   * an id prefix — `counter/` runs one component's Showcases. A failing play is
   * a datum here too; only a prefix that matches nothing fails, with
   * {@link NoShowcaseMatchedError} carrying the ids it could have matched.
   *
   * Fresh from disk, on the same terms as {@link runById} — including the
   * directory walk, so a file written since the server started is in the suite.
   */
  readonly runAll: (
    prefix: Option.Option<string>,
  ) => Effect.Effect<SuiteReport, NoShowcaseMatchedError>
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
 * The catalog being served: one load, plus the directory it came from. The
 * directory is `None` only for a catalog served from memory. It holds
 * the loader's own {@link CatalogLoad} rather than bare records, so a report the
 * server hands back names the file it came from, exactly as `foldcase test` does.
 */
interface CatalogState extends CatalogLoad {
  readonly dir: Option.Option<string>
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

/**
 * How a catalog runs a selection of its plays. The two implementations are the
 * whole of ADR-0001 › Amendment 4: a catalog read from a directory runs it in a
 * child process, which reads the files again and so runs the code on disk; an
 * in-memory catalog runs it here, because its plays are closures this process
 * holds and no other process can be handed.
 */
type CatalogRunner = (
  state: CatalogState,
  selection: FreshSelection,
) => Effect.Effect<FreshRunDocument, FreshRunError>

/**
 * Introspect one of a Showcase's declared Schemas into a JSON Schema document,
 * or fail for the one it did not declare. Message and Model are introspected
 * the same way and answer in the same shape, so they read the same way too.
 */
const introspect = <E>(
  id: string,
  schema: Schema.Top | undefined,
  onMissing: () => E,
): Effect.Effect<ShowcaseSchema, E> =>
  schema === undefined
    ? Effect.fail(onMissing())
    : Effect.succeed(new ShowcaseSchema({ id, jsonSchema: Schema.toJsonSchemaDocument(schema) }))

/**
 * The report for a run that never happened: the child would not start, or
 * answered something this request cannot read. It is a failed *report* rather
 * than a tool error because the caller asked for a verdict on a play, and
 * "could not run it, here is why" is a verdict — silence, or a bare tool
 * failure, would leave an agent to guess whether its Showcase is broken.
 */
const runFailureReport = (id: string, reason: string): ShowcaseReport =>
  new ShowcaseReport({
    id,
    status: "failed",
    error: new SerializedError({ name: FreshRunError.identifier, message: reason }),
  })

/** Read a fresh run's document as the answer `runById` declares. */
const showcaseReportOf = (
  id: string,
  document: FreshRunDocument,
): Effect.Effect<ShowcaseReport, ShowcaseNotFoundError> => {
  switch (document._tag) {
    case "foldcase/RanShowcase":
      return Effect.succeed(document.report)
    case "foldcase/NoSuchShowcase":
      return Effect.fail(
        new ShowcaseNotFoundError({ id: document.id, available: document.available }),
      )
    default:
      // A selection of one can only answer with those two. Reaching here means
      // the run answered a different question — report it, rather than inventing
      // a pass or a fail.
      return Effect.succeed(runFailureReport(id, `a run of ${id} answered ${document._tag}`))
  }
}

/** Read a fresh run's document as the answer `runAll` declares. */
const suiteReportOf = (
  key: string,
  document: FreshRunDocument,
): Effect.Effect<SuiteReport, NoShowcaseMatchedError> => {
  switch (document._tag) {
    case "foldcase/RanSuite":
      return Effect.succeed(document.suite)
    case "foldcase/NoSuchPrefix":
      return Effect.fail(
        new NoShowcaseMatchedError({ prefix: document.prefix, available: document.available }),
      )
    default:
      return Effect.succeed(
        suiteOf([runFailureReport(key, `a run of ${key} answered ${document._tag}`)]),
      )
  }
}

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
  runFresh: CatalogRunner,
): Effect.Effect<FoldcaseCatalogShape> =>
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make(initial)

    // Every run reads the served catalog for its directory, and nothing else:
    // the ids, the files and the plays all come from the run itself.
    const run = (selection: FreshSelection): Effect.Effect<FreshRunDocument, FreshRunError> =>
      SynchronizedRef.get(state).pipe(Effect.flatMap((current) => runFresh(current, selection)))

    // Finds the loaded entry, not the bare record: the file travels with it, so
    // a single-Showcase run reports which file to open just as a whole run does.
    const find = (id: string): Effect.Effect<LoadedShowcase, ShowcaseNotFoundError> =>
      SynchronizedRef.get(state).pipe(
        Effect.flatMap((current) =>
          Arr.findFirst(current.loaded, (entry) => entry.showcase.id === id).pipe(
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
                    hasModelSchema: showcase.model !== undefined,
                  }),
              ),
            }),
        ),
      ),
      schemaFor: (id) =>
        find(id).pipe(
          Effect.flatMap(({ showcase }) =>
            introspect(id, showcase.message, () => new NoMessageSchemaError({ id })),
          ),
        ),
      modelSchemaFor: (id) =>
        find(id).pipe(
          Effect.flatMap(({ showcase }) =>
            introspect(id, showcase.model, () => new NoModelSchemaError({ id })),
          ),
        ),
      runById: (id) =>
        run(FreshSelection.One({ id })).pipe(
          Effect.flatMap((document) => showcaseReportOf(id, document)),
          Effect.catchTag("foldcase/FreshRunError", (error) =>
            Effect.succeed(runFailureReport(id, error.reason)),
          ),
        ),
      runAll: (prefix) => {
        const key = Option.getOrElse(prefix, () => "the catalog")
        return run(
          Option.match(prefix, {
            onNone: () => FreshSelection.Every(),
            onSome: (start) => FreshSelection.Under({ prefix: start }),
          }),
        ).pipe(
          Effect.flatMap((document) => suiteReportOf(key, document)),
          Effect.catchTag("foldcase/FreshRunError", (error) =>
            Effect.succeed(suiteOf([runFailureReport(key, error.reason)])),
          ),
        )
      },
      load: (dir) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          read(dir, current.dir).pipe(Effect.map((next) => [reportOf(next), next] as const)),
        ),
    }
  })

/**
 * Run a selection here, in this process, over the catalog already loaded. The
 * only way to run an in-memory catalog: a `play` is a closure, and a closure
 * cannot be handed to a process that has never seen the module holding it.
 */
const runInProcess: CatalogRunner = (state, selection) => runSelection(state, selection)

/**
 * Build the catalog surface over an in-memory set of Showcases — the shape
 * tests and embedders use, with no disk behind it. Nothing backs it, so `load`
 * re-serves what it already holds rather than reading a directory.
 */
export const makeCatalog = (
  showcases: ReadonlyArray<Showcase>,
): Effect.Effect<FoldcaseCatalogShape> => {
  const state: CatalogState = {
    dir: Option.none(),
    failures: [],
    loaded: showcases.map((showcase) => ({ showcase })),
    showcases,
  }
  return makeCatalogWith(state, () => Effect.succeed(state), runInProcess)
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
    return { ...load, dir: Option.some(dir) }
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    // Resolve to an absolute dir first: discovered paths are dynamically
    // imported, and `import()` resolves a relative path against the importing
    // module, not the cwd, so a relative FOLDCASE_SHOWCASE_DIR would not load.
    const path = yield* Path.Path
    const root = path.resolve(dir)
    // The reader outlives this Effect — every later load re-runs it, from a
    // tool call — so it carries the platform services rather than asking the
    // caller's context for them again. The runner below outlives it for the
    // same reason, and needs the spawner on top of them.
    const services = yield* Effect.context<
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
    >()
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
    // Discovery is part of the run, not of the load: the walk hits the disk
    // every time, so a `*.showcase.ts` written since the server started is in
    // the suite without anyone calling `foldcase_load_catalog` first.
    const runFresh: CatalogRunner = (current, selection) =>
      Option.match(current.dir, {
        onNone: () => runInProcess(current, selection),
        onSome: (served) =>
          discoverShowcaseFiles(served).pipe(
            // The one thing here that is not data: the directory being served
            // has gone. Normalise the platform error once, at this boundary,
            // into the error the run reports.
            Effect.mapError(
              (cause: PlatformError) =>
                new FreshRunError({ reason: `${served}: ${cause.message}` }),
            ),
            Effect.flatMap((files) => spawnFreshRun(selection, files)),
          ),
      }).pipe(Effect.provideContext(services))
    const initial = yield* read(Option.none(), Option.none())
    return yield* makeCatalogWith(initial, read, runFresh)
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
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  > = Layer.effect(FoldcaseCatalog)(showcaseDir.pipe(Effect.flatMap(loadCatalogFromDir)))

  /** Test/embed layer: serves a fixed set of Showcases with no disk access. */
  static readonly layerFromShowcases = (
    showcases: ReadonlyArray<Showcase>,
  ): Layer.Layer<FoldcaseCatalog> => Layer.effect(FoldcaseCatalog)(makeCatalog(showcases))
}
