// The Foldcase CLI as a runtime-agnostic program.
//
// Everything the CLI *does* lives here: parsing the argument vector, resolving
// a target, running the suite, collecting coverage, writing docs, serving the
// catalog over MCP. Nothing here names a runtime — the platform services it
// needs (FileSystem, Path, ChildProcessSpawner, Stdio) arrive from the context,
// and the exit code is returned as a value instead of written to `process`.
//
// The per-runtime shells (`src/main.ts` on Node, `src/main.bun.ts` on Bun) are
// the only modules that bind one. See ADR-0002 › Amendment 1.

import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import {
  discoverShowcaseFiles,
  docsFromFiles,
  loadShowcasesFromFiles,
  runCatalog,
  ShowcaseModuleError,
} from "./cli.js"
import { collectCoverage } from "./coverage/collect.js"
import { CoverageReport, formatCoverage } from "./coverage/report.js"
import { writeComponentDocs, WrittenDoc } from "./docs/generate.js"
import { FoldcaseMcpServer } from "./mcp/server.js"
import { formatSuite, type Showcase, SuiteReport, suiteExitCode } from "./runner.js"

/** The one-line usage banner, printed to stderr for an unknown subcommand. */
export const usage =
  "usage: foldcase <test [dir-or-file] [--coverage] [--json] | docs [dir] [out-dir] [--json] | mcp>   (test/docs default to the current directory; --coverage adds a V8 line/function coverage summary; --json prints one JSON document on stdout instead of the summary, diagnostics on stderr; docs writes Schema-table Markdown to out-dir, default FOLDCASE_DOCS_DIR; mcp serves the catalog over stdio)"

/** What the argument vector asked for. */
export type Command = Data.TaggedEnum<{
  /**
   * Run every Showcase under `target`, optionally with a coverage summary and
   * optionally as one JSON document instead of the human summary.
   */
  readonly Test: {
    readonly target: string
    readonly coverage: boolean
    readonly json: boolean
  }
  /** Render Schema-table autodocs for every Showcase under `target`. */
  readonly Docs: {
    readonly target: string
    readonly outDir: Option.Option<string>
    readonly json: boolean
  }
  /** Serve the catalog to an agent over stdio MCP. */
  readonly Mcp: object
  /**
   * Nothing recognisable was asked for; print the banner and fail. `reason`
   * carries the one line the banner cannot say — which word was not understood
   * — and is `None` when the banner alone tells the whole story.
   */
  readonly Usage: { readonly reason: Option.Option<string> }
}>

export const Command = Data.taggedEnum<Command>()

const DEFAULT_TARGET = "."

/**
 * A verb that was handed more positionals than it takes is {@link Command.Usage},
 * not the part of the request we happened to understand. `foldcase test a.ts b.ts`
 * used to run `a.ts` alone and exit 0, so a CI job asking for two catalogs passed
 * forever over one of them. The banner alone would leave the user to work out
 * which word was one too many, so the reason names them; the banner still follows
 * it, because the reader also needs the form that would have worked.
 */
const refusal = (takes: string, words: ReadonlyArray<string>): Option.Option<Command> =>
  Arr.isReadonlyArrayEmpty(words)
    ? Option.none()
    : Option.some(
        Command.Usage({
          reason: Option.some(`${takes}; it did not understand: ${words.join(", ")}`),
        }),
      )

const surplus = (
  takes: string,
  limit: number,
  positionals: ReadonlyArray<string>,
): Option.Option<Command> => refusal(takes, positionals.slice(limit))

/**
 * A flag the verb does not know is a refusal too, and for the same reason: a
 * dropped `--covrage` ran the suite without coverage and exited 0, so the typo
 * read as a clean run — the worst answer a tool can give an agent. The `takes`
 * phrase names the flags that would have worked, since a misspelling is nearly
 * always a near miss of one of them.
 */
const unknown = (
  takes: string,
  known: ReadonlyArray<string>,
  flags: ReadonlySet<string>,
): Option.Option<Command> => refusal(takes, [...flags].filter((flag) => !known.includes(flag)))

/**
 * Read the argument vector (already stripped of the runtime and script paths).
 * Flags are split from positionals, so `--coverage` may sit on either side of
 * the target (`foldcase test --coverage src` and `foldcase test src --coverage`
 * mean the same thing). Anything but a known subcommand, given the positionals
 * that subcommand takes, is {@link Command.Usage}.
 */
export const parseCommand = (argv: ReadonlyArray<string>): Command => {
  const isFlag = (argument: string): boolean => argument.startsWith("--")
  const flags = new Set(argv.filter(isFlag))
  const words = argv.filter((argument) => !isFlag(argument))
  // The first word is the verb; everything after it is that verb's positionals.
  const [subcommand, target, outDir] = words
  const positionals = words.slice(1)
  switch (subcommand) {
    case "test":
      return Option.getOrElse(
        Option.orElse(surplus("test takes one target", 1, positionals), () =>
          unknown("test takes --coverage and --json", ["--coverage", "--json"], flags),
        ),
        () =>
          Command.Test({
            target: target ?? DEFAULT_TARGET,
            coverage: flags.has("--coverage"),
            json: flags.has("--json"),
          }),
      )
    case "docs":
      return Option.getOrElse(
        Option.orElse(surplus("docs takes a target and an out-dir", 2, positionals), () =>
          unknown("docs takes --json", ["--json"], flags),
        ),
        () =>
          Command.Docs({
            target: target ?? DEFAULT_TARGET,
            outDir: Option.fromUndefinedOr(outDir),
            json: flags.has("--json"),
          }),
      )
    case "mcp":
      return Option.getOrElse(
        Option.orElse(surplus("mcp takes no target", 0, positionals), () =>
          unknown("mcp takes no flags", [], flags),
        ),
        () => Command.Mcp(),
      )
    default:
      return Command.Usage({ reason: Option.none() })
  }
}

// The default output directory for `foldcase docs`, overridable by the second
// positional argument. Read via Config, never the raw environment.
const docsDir = Config.string("FOLDCASE_DOCS_DIR").pipe(Config.withDefault("foldcase-docs"))

// Resolve a target to the showcase files and the `root` dir coverage is scoped
// to: a directory is its own root; a single file is rooted at its directory.
const resolveTarget = Effect.fn("foldcase.resolveTarget")(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const resolved = path.resolve(target)
  const info = yield* fs.stat(resolved)
  if (info.type === "Directory") {
    return { root: resolved, files: yield* discoverShowcaseFiles(resolved) }
  }
  return { root: path.dirname(resolved), files: [resolved] }
})

// Additive coverage: collect it, but a collection failure (e.g. Node not
// installed) is a note on stderr and no report, never a change to the run's
// pass/fail exit code.
const coverageOf = Effect.fn("foldcase.test.coverage")(
  function* (root: string, files: ReadonlyArray<string>, showcases: ReadonlyArray<Showcase>) {
    return Option.some(yield* collectCoverage(root, files, showcases))
  },
  Effect.catchTag("foldcase/CoverageCollectionError", (error) =>
    Console.error(`foldcase: coverage unavailable — ${error.reason}`).pipe(
      Effect.as(Option.none<CoverageReport>()),
    ),
  ),
)

/**
 * What `foldcase test --json` prints: the suite report, and the coverage report
 * beside it when `--coverage` collected one. One document, so a reader parses
 * stdout once instead of splitting a summary from a report printed after it.
 */
export class TestDocument extends Schema.Class<TestDocument>("foldcase/TestDocument")({
  suite: SuiteReport,
  coverage: Schema.optional(CoverageReport),
}) {}

const encodeTestDocument = Schema.encodeEffect(Schema.fromJsonString(TestDocument))

// The document is the encoded Schema value, so what an agent parses is the same
// contract the runner reports. An encode failure would mean the Schema
// disagrees with the report just built — a defect, not a caller's problem.
const printTestDocument = (suite: SuiteReport, coverage: Option.Option<CoverageReport>) =>
  encodeTestDocument(
    new TestDocument({ suite, coverage: Option.getOrUndefined(coverage) }),
  ).pipe(Effect.orDie, Effect.flatMap(Console.log))

const printSuite = (suite: SuiteReport, coverage: Option.Option<CoverageReport>) =>
  Console.log(formatSuite(suite)).pipe(
    Effect.andThen(
      Option.match(coverage, {
        onNone: () => Effect.void,
        onSome: (report) => Console.log(`\ncoverage:\n${formatCoverage(report)}`),
      }),
    ),
  )

// Discovering zero showcases is a failure, not an empty pass: an exit-0 with no
// coverage reads as "everything passed" and green-lights a misconfigured run.
const noShowcases = (target: string) =>
  Console.error(`foldcase: no *.showcase.ts found under ${target}`).pipe(Effect.as(1))

const test = Effect.fn("foldcase.test")(function* (
  target: string,
  coverage: boolean,
  json: boolean,
) {
  const { root, files } = yield* resolveTarget(target)
  if (Arr.isReadonlyArrayEmpty(files)) {
    return yield* noShowcases(target)
  }
  // Load once: the suite runs the loaded catalog and coverage projects it, so
  // both surfaces see exactly the same Showcase records (ADR-0001, one loader).
  // A file that would not load is a failed entry in the suite, not the end of
  // the run — the other files still have results worth having.
  const load = yield* loadShowcasesFromFiles(files)
  const suite = yield* runCatalog(load)
  const collected = coverage
    ? yield* coverageOf(root, files, load.showcases)
    : Option.none<CoverageReport>()
  yield* json ? printTestDocument(suite, collected) : printSuite(suite, collected)
  return suiteExitCode(suite)
})

/**
 * What `foldcase docs --json` prints: the documents written, by component and
 * path, and the files that would not load, with the reason each was skipped.
 * The same two facts the human output says, in the order a reader needs them.
 */
export class DocsDocument extends Schema.Class<DocsDocument>("foldcase/DocsDocument")({
  docs: Schema.Array(WrittenDoc),
  failures: Schema.Array(ShowcaseModuleError),
}) {}

const encodeDocsDocument = Schema.encodeEffect(Schema.fromJsonString(DocsDocument))

const printDocsDocument = (
  written: ReadonlyArray<WrittenDoc>,
  failures: ReadonlyArray<ShowcaseModuleError>,
) =>
  encodeDocsDocument(new DocsDocument({ docs: written, failures })).pipe(
    Effect.orDie,
    Effect.flatMap(Console.log),
  )

const printWritten = (outDir: string, written: ReadonlyArray<WrittenDoc>) =>
  Console.log(`foldcase docs: wrote ${written.length} doc(s) to ${outDir}`).pipe(
    Effect.andThen(
      Effect.forEach(written, (doc) => Console.log(`  ${doc.path}`), {
        concurrency: 1,
        discard: true,
      }),
    ),
  )

const docs = Effect.fn("foldcase.docs")(function* (
  target: string,
  outOverride: Option.Option<string>,
  json: boolean,
) {
  const { files } = yield* resolveTarget(target)
  // Same guard as `test`: discovering zero showcases is a misconfiguration, not
  // an empty success — never green-light a docs run that found nothing.
  if (Arr.isReadonlyArrayEmpty(files)) {
    return yield* noShowcases(target)
  }
  const { docs: generated, failures } = yield* docsFromFiles(files)
  const outDir = yield* Option.match(outOverride, {
    onNone: () => docsDir,
    onSome: Effect.succeed,
  })
  const written = yield* writeComponentDocs(outDir, generated)
  yield* json ? printDocsDocument(written, failures) : printWritten(outDir, written)
  // Documenting what loaded is worth doing, but a file that would not load is
  // missing from the output — say which, and let the exit code say it too. The
  // document already carries them; this is the note for a reader watching the
  // terminal, so it stays on stderr in both modes.
  yield* Effect.forEach(failures, (failure) => Console.error(`foldcase docs: ${failure.message}`), {
    concurrency: 1,
    discard: true,
  })
  return Arr.isReadonlyArrayEmpty(failures) ? 0 : 1
})

// In JSON mode stdout carries the document and nothing else, so the built-in
// logger — which writes to stdout — moves to stderr for the run, where every
// other diagnostic already goes. The MCP server reserves stdout the same way.
const reserveStdout = <A, E, R>(json: boolean, command: Effect.Effect<A, E, R>) =>
  json ? Effect.provide(command, Layer.succeed(Logger.LogToStderr)(true)) : command

/**
 * Run one {@link Command} to the process exit code the shell should set. `Mcp`
 * is a long-running stdio server, so it only ever returns by failing — its
 * `never` result unifies with the exit codes of the one-shot subcommands.
 */
export const runCommand = Command.$match({
  Test: ({ coverage, json, target }) => reserveStdout(json, test(target, coverage, json)),
  Docs: ({ json, outDir, target }) => reserveStdout(json, docs(target, outDir, json)),
  Mcp: () => Layer.launch(FoldcaseMcpServer),
  // The reason goes above the banner, so a reader meets the word that was
  // wrong before the form that is right — both on stderr, both in one write.
  Usage: ({ reason }) =>
    Console.error(
      Option.match(reason, {
        onNone: () => usage,
        onSome: (said) => `foldcase: ${said}\n${usage}`,
      }),
    ).pipe(Effect.as(1)),
})

/**
 * The whole CLI: parse the argument vector and run it to an exit code. This is
 * everything a shell does apart from binding a runtime.
 */
export const run = (argv: ReadonlyArray<string>) => runCommand(parseCommand(argv))
