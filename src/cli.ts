import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Order from "effect/Order"
import * as P from "effect/Predicate"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import { type ComponentDoc, generateComponentDocs } from "./docs/generate.js"
import type { SchemaIntrospectionError } from "./docs/schema-table.js"
import {
  runShowcase,
  SerializedError,
  type Showcase,
  ShowcaseReport,
  suiteOf,
  type SuiteReport,
} from "./runner.js"

const SHOWCASE_SUFFIX = ".showcase.ts"

/**
 * Recursively find every `*.showcase.ts` file under `dir`, as absolute paths in
 * a stable (sorted) order so the suite report is deterministic run to run.
 */
export const discoverShowcaseFiles = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(dir, { recursive: true })
    const files = entries
      .filter((entry) => entry.endsWith(SHOWCASE_SUFFIX))
      .map((entry) => path.join(dir, entry))
    return Arr.sort(files, Order.String)
  })

/**
 * A showcase module (`*.showcase.ts`) failed to load or did not export the
 * expected `showcases: ReadonlyArray<Showcase>`. Tagged so the CLI can report
 * a malformed catalog distinctly from a Showcase that ran and failed.
 */
export class ShowcaseModuleError extends Schema.TaggedErrorClass<ShowcaseModuleError>()(
  "foldcase/ShowcaseModuleError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {
  /**
   * A schema-backed error carries its payload in fields, so its inherited
   * `Error.message` is empty and a runtime that prints an unhandled failure
   * shows only the tag. Render the payload instead, so the user reads *which*
   * file would not load and *why*.
   */
  override get message(): string {
    return `${this.path}: ${this.reason}`
  }
}

const isShowcase = (value: unknown): value is Showcase => {
  if (
    !P.isObject(value) ||
    !P.isString(Reflect.get(value, "id")) ||
    !P.isFunction(Reflect.get(value, "play"))
  ) {
    return false
  }
  // `message`/`model` are optional, but when a module declares either it must be
  // an Effect Schema: the catalog and docs generator feed it to
  // `Schema.toJsonSchemaDocument`, so a non-Schema value (from an untrusted
  // `*.showcase.ts`) would defect outside the declared typed errors. Reject the
  // module as malformed instead.
  const isSchemaOrAbsent = (key: string): boolean => {
    const candidate = Reflect.get(value, key)
    return candidate === undefined || Schema.isSchema(candidate)
  }
  return isSchemaOrAbsent("message") && isSchemaOrAbsent("model")
}

const readShowcases = (
  path: string,
  module: unknown,
): Effect.Effect<ReadonlyArray<Showcase>, ShowcaseModuleError> => {
  const exported = P.isObject(module) ? Reflect.get(module, "showcases") : undefined
  if (!Array.isArray(exported) || !exported.every(isShowcase)) {
    return Effect.fail(
      new ShowcaseModuleError({
        path,
        reason: "module must export `showcases: ReadonlyArray<Showcase>` ({ id, play })",
      }),
    )
  }
  return Effect.succeed(exported)
}

const loadShowcaseFile = (
  path: string,
): Effect.Effect<ReadonlyArray<Showcase>, ShowcaseModuleError> =>
  Effect.tryPromise({
    try: () => import(path),
    catch: (cause) => new ShowcaseModuleError({ path, reason: String(cause) }),
  }).pipe(Effect.flatMap((module) => readShowcases(path, module)))

/**
 * One Showcase and the `*.showcase.ts` it was read from. The file is not part
 * of the {@link Showcase} record — the author does not declare it, the loader
 * knows it — so it is carried beside the record instead (ADR-0001: a new field
 * on the record is a reviewed act, and this fact is not one of its facts).
 */
export interface LoadedShowcase {
  readonly file: string
  readonly showcase: Showcase
}

/**
 * What one pass of the loader produced: the Showcases it read, each with its
 * file, in file order, and the files it could not read at all.
 *
 * A file that will not load is **data**, not an Effect failure. It used to be
 * one, and the cost was the whole point of running a suite: a single
 * `*.showcase.ts` with a bad import aborted the run, so none of the other files
 * were even attempted and the user learned nothing about them. Every surface
 * now decides what a failure means for it — `test` reports it as a failed file
 * and exits non-zero, `docs` says so on stderr, `mcp` warns and serves the rest.
 */
export interface CatalogLoad {
  readonly loaded: ReadonlyArray<LoadedShowcase>
  /** {@link loaded} with the file dropped, for the surfaces that only run records. */
  readonly showcases: ReadonlyArray<Showcase>
  readonly failures: ReadonlyArray<ShowcaseModuleError>
}

/**
 * Load every showcase file, collecting their Showcases in file order and the
 * load failures beside them. Never fails: one unreadable file must not decide
 * the fate of the others. Shared by `foldcase test` (run them), `foldcase docs`
 * (document them) and `foldcase mcp` (serve them as a catalog).
 */
export const loadShowcasesFromFiles = (
  paths: ReadonlyArray<string>,
): Effect.Effect<CatalogLoad> =>
  Effect.forEach(
    paths,
    (file) => Effect.result(loadShowcaseFile(file)).pipe(Effect.map((result) => ({ file, result }))),
    { concurrency: 1 },
  ).pipe(
    Effect.map((results) => {
      const loaded: ReadonlyArray<LoadedShowcase> = results.flatMap(({ file, result }) =>
        result._tag === "Success" ? result.success.map((showcase) => ({ file, showcase })) : [],
      )
      return {
        loaded,
        showcases: loaded.map((entry) => entry.showcase),
        failures: results.flatMap(({ result }) =>
          result._tag === "Failure" ? [result.failure] : [],
        ),
      }
    }),
  )

/**
 * The report for a file that never produced a Showcase. It is keyed by the
 * file's path — there is no id to key it by, because the module that would have
 * declared one never evaluated.
 */
const loadFailureReport = (failure: ShowcaseModuleError): ShowcaseReport =>
  new ShowcaseReport({
    id: failure.path,
    status: "failed",
    error: new SerializedError({ name: failure._tag, message: failure.reason }),
    file: failure.path,
  })

/**
 * Load every showcase file and run the whole set into one {@link SuiteReport}.
 * A file that would not load is reported as a failed entry for that file, ahead
 * of the Showcases that did run — so the suite verdict is non-zero and the
 * reason is on the same page as the results.
 */
export const runSuiteFromFiles = (paths: ReadonlyArray<string>): Effect.Effect<SuiteReport> =>
  loadShowcasesFromFiles(paths).pipe(Effect.flatMap(runCatalog))

/**
 * Run a loaded catalog, folding its load failures into the suite report. Runs
 * the loaded entries rather than the bare records, so every report names the
 * file it came from.
 */
export const runCatalog = (load: CatalogLoad): Effect.Effect<SuiteReport> =>
  Effect.forEach(load.loaded, (entry) => runShowcase(entry.showcase, entry.file), {
    concurrency: 1,
  }).pipe(Effect.map((reports) => suiteOf([...load.failures.map(loadFailureReport), ...reports])))

/**
 * Load every showcase file and render the Model/Message Schema autodocs. The
 * `failures` are handed back untouched, so the shell can say which files were
 * skipped. Fails {@link SchemaIntrospectionError} only when a declared Schema
 * cannot be introspected.
 */
export const docsFromFiles = (
  paths: ReadonlyArray<string>,
): Effect.Effect<
  { readonly docs: ReadonlyArray<ComponentDoc>; readonly failures: CatalogLoad["failures"] },
  SchemaIntrospectionError
> =>
  loadShowcasesFromFiles(paths).pipe(
    Effect.flatMap((load) =>
      generateComponentDocs(load.showcases).pipe(
        Effect.map((docs) => ({ docs, failures: load.failures })),
      ),
    ),
  )
