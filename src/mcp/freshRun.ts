// A fresh run: the plays, executed by a process that has just started.
//
// The MCP server holds its catalog in memory, and both runtimes cache an ES
// module by URL — so re-importing a `*.showcase.ts` an agent has just edited
// hands back the module that was already loaded. `foldcase_load_catalog` cannot
// fix that: it re-imports the same URL. The agent then reads a report of the
// code it replaced and concludes its fix did not work, which is the worst
// answer this tool can give.
//
// So a run leaves the process. The parent discovers the files (a directory walk
// hits the disk every time, so a file written since startup is included), hands
// them to a child of the *current* runtime, and the child imports them for the
// first time in its life. Nothing is cached, because nothing has run yet.
//
// The catalog record is still the single description of a component
// (ADR-0001): the child reads it with the one loader, in another process, and
// answers with the same report Schemas every other surface answers with.

import * as Arr from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { type CatalogLoad, runCatalog } from "../cli.js"
import { runShowcase, ShowcaseReport, SuiteReport } from "../runner.js"

/**
 * Which plays a fresh run should run: one by id, the ones under an id prefix,
 * or every one the catalog holds. It is the MCP run verbs' request, reduced to
 * what survives a process boundary — a name, never a closure.
 */
export type FreshSelection = Data.TaggedEnum<{
  /** One Showcase, by exact id — `foldcase_run_showcase`. */
  readonly One: { readonly id: string }
  /** Every Showcase whose id starts with `prefix` — one component. */
  readonly Under: { readonly prefix: string }
  /** The whole catalog. */
  readonly Every: object
}>

export const FreshSelection = Data.taggedEnum<FreshSelection>()

/** The selector word each selection is written with, empty for the whole catalog. */
const selectorOf = FreshSelection.$match({
  One: ({ id }) => id,
  Under: ({ prefix }) => prefix,
  Every: () => "",
})

/**
 * The child's argument vector: the selection as a mode word and a selector
 * word, then the files to load. Positional and fixed-width on purpose — an id
 * may begin with a dash, and a flag parser would read it as a flag.
 */
export const freshRunArgv = (
  selection: FreshSelection,
  files: ReadonlyArray<string>,
): ReadonlyArray<string> => [selection._tag, selectorOf(selection), ...files]

/** What one fresh run was asked for: the plays to run and the files to read. */
export interface FreshRunRequest {
  readonly selection: FreshSelection
  readonly files: ReadonlyArray<string>
}

/**
 * Read back what {@link freshRunArgv} wrote. `None` for an argument vector this
 * module did not write — the child is spawned by the parent alone, so that is a
 * defect rather than a user's mistake, and the child says so on stderr.
 */
export const parseFreshRunArgv = (argv: ReadonlyArray<string>): Option.Option<FreshRunRequest> => {
  const [mode, selector] = argv
  const files = argv.slice(2)
  if (mode === undefined || selector === undefined) {
    return Option.none()
  }
  switch (mode) {
    case "One":
      return Option.some({ selection: FreshSelection.One({ id: selector }), files })
    case "Under":
      return Option.some({ selection: FreshSelection.Under({ prefix: selector }), files })
    case "Every":
      return Option.some({ selection: FreshSelection.Every(), files })
    default:
      return Option.none()
  }
}

// ── What a fresh run answers with ────────────────────────────────────────────
//
// One JSON document on stdout, decoded by the Schemas below. Every variant is
// built from the report Schemas `src/runner.ts` already declares, so what the
// child writes is what `foldcase test` reports — no second shape crosses the
// boundary (ADR-0001).

/** One Showcase ran. The report carries the pass/fail and the file it came from. */
export class RanShowcase extends Schema.TaggedClass<RanShowcase>()("foldcase/RanShowcase", {
  report: ShowcaseReport,
}) {}

/** A set of Showcases ran, rolled into the suite verdict `foldcase test` gives. */
export class RanSuite extends Schema.TaggedClass<RanSuite>()("foldcase/RanSuite", {
  suite: SuiteReport,
}) {}

/**
 * Nothing in the freshly-read catalog carries that id. The ids that are there
 * travel with it, so the caller's error can name them without a second load.
 */
export class NoSuchShowcase extends Schema.TaggedClass<NoSuchShowcase>()(
  "foldcase/NoSuchShowcase",
  {
    id: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {}

/** No id in the freshly-read catalog starts with that prefix. */
export class NoSuchPrefix extends Schema.TaggedClass<NoSuchPrefix>()("foldcase/NoSuchPrefix", {
  prefix: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

/** The one document a fresh run prints, whichever selection it was asked for. */
export const FreshRunDocument = Schema.Union([RanShowcase, RanSuite, NoSuchShowcase, NoSuchPrefix])

export type FreshRunDocument = typeof FreshRunDocument.Type

/**
 * Run a selection over a catalog that has just been loaded, and say what came
 * of it.
 *
 * This is the *whole* meaning of the two run verbs, and it is deliberately one
 * function: the in-process path (an in-memory catalog, whose plays are closures
 * that cannot be respawned) and the child process run the same code over the
 * same {@link CatalogLoad}, so crossing a process boundary changes where the
 * catalog was read and nothing else about the answer.
 */
export const runSelection = (
  load: CatalogLoad,
  selection: FreshSelection,
): Effect.Effect<FreshRunDocument> => {
  const available = load.showcases.map((showcase) => showcase.id)
  return FreshSelection.$match(selection, {
    One: ({ id }) =>
      Arr.findFirst(load.loaded, (entry) => entry.showcase.id === id).pipe(
        Option.match({
          onNone: () => Effect.succeed(new NoSuchShowcase({ id, available })),
          onSome: (entry) =>
            runShowcase(entry.showcase, entry.file).pipe(
              Effect.map((report) => new RanShowcase({ report })),
            ),
        }),
      ),
    Under: ({ prefix }) => {
      const selected = load.loaded.filter((entry) => entry.showcase.id.startsWith(prefix))
      if (Arr.isReadonlyArrayEmpty(selected)) {
        return Effect.succeed(new NoSuchPrefix({ prefix, available }))
      }
      // Through the loader's own suite verb, so the whole-catalog verdict is the
      // one `foldcase test` gives: a file that would not load is a failed entry
      // beside the plays. Its Showcases never got ids, so a prefix cannot tell
      // whether one of them would have matched — the honest answer is to report
      // the file either way.
      return ranSuite({
        loaded: selected,
        showcases: selected.map((entry) => entry.showcase),
        failures: load.failures,
      })
    },
    Every: () => ranSuite(load),
  })
}

const ranSuite = (load: CatalogLoad): Effect.Effect<RanSuite> =>
  runCatalog(load).pipe(Effect.map((suite) => new RanSuite({ suite })))
