import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Order from "effect/Order"
import * as P from "effect/Predicate"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import { generateShowcaseDocs, type ShowcaseDoc } from "./docs/generate.js"
import type { SchemaIntrospectionError } from "./docs/schema-table.js"
import { runShowcases, type Showcase, type SuiteReport } from "./runner.js"

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
 * Load every showcase file and collect their Showcases in file order. Fails
 * with a {@link ShowcaseModuleError} if any file is missing or malformed (a
 * broken catalog is not a test result). Shared by `foldcase test` (run them)
 * and `foldcase mcp` (serve them as a catalog).
 */
export const loadShowcasesFromFiles = (
  paths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Showcase>, ShowcaseModuleError> =>
  Effect.forEach(paths, loadShowcaseFile, { concurrency: 1 }).pipe(
    Effect.map((groups) => groups.flat()),
  )

/**
 * Load every showcase file, collect their Showcases in file order, and run the
 * whole set into one {@link SuiteReport}. Fails with a {@link ShowcaseModuleError}
 * if any file is missing or malformed (a broken catalog is not a test result).
 */
export const runSuiteFromFiles = (
  paths: ReadonlyArray<string>,
): Effect.Effect<SuiteReport, ShowcaseModuleError> =>
  loadShowcasesFromFiles(paths).pipe(Effect.flatMap(runShowcases))

/**
 * Load every showcase file and render one autodoc per Showcase (Model/Message
 * Schema tables). Fails {@link ShowcaseModuleError} on a broken catalog, or
 * {@link SchemaIntrospectionError} when a declared Schema can't be introspected.
 * Shared by `foldcase docs` (the imperative shell resolves + writes the output).
 */
export const docsFromFiles = (
  paths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ShowcaseDoc>, ShowcaseModuleError | SchemaIntrospectionError> =>
  loadShowcasesFromFiles(paths).pipe(Effect.flatMap(generateShowcaseDocs))
