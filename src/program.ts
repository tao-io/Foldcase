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
import * as Option from "effect/Option"
import * as Path from "effect/Path"

import { discoverShowcaseFiles, docsFromFiles, loadShowcasesFromFiles, runCatalog } from "./cli.js"
import { collectCoverage } from "./coverage/collect.js"
import { formatCoverage } from "./coverage/report.js"
import { writeComponentDocs } from "./docs/generate.js"
import { FoldcaseMcpServer } from "./mcp/server.js"
import { formatSuite, type Showcase, suiteExitCode } from "./runner.js"

/** The one-line usage banner, printed to stderr for an unknown subcommand. */
export const usage =
  "usage: foldcase <test [dir-or-file] [--coverage] | docs [dir] [out-dir] | mcp>   (test/docs default to the current directory; --coverage adds a V8 line/function coverage summary; docs writes Schema-table Markdown to out-dir, default FOLDCASE_DOCS_DIR; mcp serves the catalog over stdio)"

/** What the argument vector asked for. */
export type Command = Data.TaggedEnum<{
  /** Run every Showcase under `target`, optionally with a coverage summary. */
  readonly Test: { readonly target: string; readonly coverage: boolean }
  /** Render Schema-table autodocs for every Showcase under `target`. */
  readonly Docs: { readonly target: string; readonly outDir: Option.Option<string> }
  /** Serve the catalog to an agent over stdio MCP. */
  readonly Mcp: object
  /** Nothing recognisable was asked for; print the banner and fail. */
  readonly Usage: object
}>

export const Command = Data.taggedEnum<Command>()

const DEFAULT_TARGET = "."

/**
 * Read the argument vector (already stripped of the runtime and script paths).
 * Flags are split from positionals, so `--coverage` may sit on either side of
 * the target (`foldcase test --coverage src` and `foldcase test src --coverage`
 * mean the same thing). Anything but a known subcommand is {@link Command.Usage}.
 */
export const parseCommand = (argv: ReadonlyArray<string>): Command => {
  const isFlag = (argument: string): boolean => argument.startsWith("--")
  const flags = argv.filter(isFlag)
  const [subcommand, target, outDir] = argv.filter((argument) => !isFlag(argument))
  switch (subcommand) {
    case "test":
      return Command.Test({
        target: target ?? DEFAULT_TARGET,
        coverage: flags.includes("--coverage"),
      })
    case "docs":
      return Command.Docs({
        target: target ?? DEFAULT_TARGET,
        outDir: Option.fromUndefinedOr(outDir),
      })
    case "mcp":
      return Command.Mcp()
    default:
      return Command.Usage()
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

// Additive coverage: collect + print, but a collection failure (e.g. Node not
// installed) is a warning, never a change to the run's pass/fail exit code.
const reportCoverage = Effect.fn("foldcase.test.coverage")(function* (
  root: string,
  files: ReadonlyArray<string>,
  showcases: ReadonlyArray<Showcase>,
) {
  const report = yield* collectCoverage(root, files, showcases)
  yield* Console.log(`\ncoverage:\n${formatCoverage(report)}`)
}, Effect.catchTag("foldcase/CoverageCollectionError", (error) =>
  Console.error(`foldcase: coverage unavailable — ${error.reason}`),
))

// Discovering zero showcases is a failure, not an empty pass: an exit-0 with no
// coverage reads as "everything passed" and green-lights a misconfigured run.
const noShowcases = (target: string) =>
  Console.error(`foldcase: no *.showcase.ts found under ${target}`).pipe(Effect.as(1))

const test = Effect.fn("foldcase.test")(function* (target: string, coverage: boolean) {
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
  yield* Console.log(formatSuite(suite))
  if (coverage) {
    yield* reportCoverage(root, files, load.showcases)
  }
  return suiteExitCode(suite)
})

const docs = Effect.fn("foldcase.docs")(function* (
  target: string,
  outOverride: Option.Option<string>,
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
  yield* Console.log(`foldcase docs: wrote ${written.length} doc(s) to ${outDir}`)
  yield* Effect.forEach(written, (doc) => Console.log(`  ${doc.path}`), {
    concurrency: 1,
    discard: true,
  })
  // Documenting what loaded is worth doing, but a file that would not load is
  // missing from the output — say which, and let the exit code say it too.
  yield* Effect.forEach(failures, (failure) => Console.error(`foldcase docs: ${failure.message}`), {
    concurrency: 1,
    discard: true,
  })
  return Arr.isReadonlyArrayEmpty(failures) ? 0 : 1
})

/**
 * Run one {@link Command} to the process exit code the shell should set. `Mcp`
 * is a long-running stdio server, so it only ever returns by failing — its
 * `never` result unifies with the exit codes of the one-shot subcommands.
 */
export const runCommand = Command.$match({
  Test: ({ coverage, target }) => test(target, coverage),
  Docs: ({ outDir, target }) => docs(target, outDir),
  Mcp: () => Layer.launch(FoldcaseMcpServer),
  Usage: () => Console.error(usage).pipe(Effect.as(1)),
})

/**
 * The whole CLI: parse the argument vector and run it to an exit code. This is
 * everything a shell does apart from binding a runtime.
 */
export const run = (argv: ReadonlyArray<string>) => runCommand(parseCommand(argv))
