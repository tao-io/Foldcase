#!/usr/bin/env bun
// foldcase — the typed self-healing test loop CLI. This is the imperative shell:
// the one place platform layers are provided and argv/stdout/exit are touched.
// All logic lives behind `./cli` + `./runner`, tested through `bun test`.

import { BunChildProcessSpawner, BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { discoverShowcaseFiles, docsFromFiles, loadShowcasesFromFiles } from "./cli"
import { collectCoverage } from "./coverage/collect"
import { formatCoverage } from "./coverage/report"
import { writeShowcaseDocs } from "./docs/generate"
import { FoldcaseMcpServer } from "./mcp/server"
import { formatSuite, type Showcase, runShowcases, suiteExitCode } from "./runner"

// The spawner (for `--coverage`'s Node subprocess) needs FileSystem/Path, so it
// wraps the fs/path layers; the whole bundle backs every one-shot subcommand.
const PlatformLive = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

const usage =
  "usage: foldcase <test [dir-or-file] [--coverage] | docs [dir] [out-dir] | mcp>   (test/docs default to the current directory; --coverage adds a V8 line/function coverage summary; docs writes Schema-table Markdown to out-dir, default FOLDCASE_DOCS_DIR; mcp serves the catalog over stdio)"

// The default output directory for `foldcase docs`, overridable by the second
// positional argument. Read via Config (the sanctioned env path at the shell).
const docsDir = Config.string("FOLDCASE_DOCS_DIR").pipe(Config.withDefault("foldcase-docs"))

// A single place to set the process exit code. Non-zero must mean "did not run
// clean" so CI never green-lights a run that discovered nothing or misfired.
const exitWith = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code
  })

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

const test = Effect.fn("foldcase.test")(function* (target: string, coverage: boolean) {
  const { root, files } = yield* resolveTarget(target)
  // Discovering zero showcases is a failure, not an empty pass: an exit-0 with no
  // coverage reads as "everything passed" and green-lights a misconfigured CI run.
  if (Arr.isReadonlyArrayEmpty(files)) {
    yield* Console.error(`foldcase: no *.showcase.ts found under ${target}`)
    return yield* exitWith(1)
  }
  // Load once: the suite runs the loaded catalog and coverage projects it, so
  // both surfaces see exactly the same Showcase records (ADR-0001, one loader).
  const showcases = yield* loadShowcasesFromFiles(files)
  const suite = yield* runShowcases(showcases)
  yield* Console.log(formatSuite(suite))
  if (coverage) {
    yield* reportCoverage(root, files, showcases)
  }
  return yield* exitWith(suiteExitCode(suite))
})

const docs = Effect.fn("foldcase.docs")(function* (target: string, outOverride?: string) {
  const { files } = yield* resolveTarget(target)
  // Same guard as `test`: discovering zero showcases is a misconfiguration, not
  // an empty success — never green-light a docs run that found nothing.
  if (Arr.isReadonlyArrayEmpty(files)) {
    yield* Console.error(`foldcase: no *.showcase.ts found under ${target}`)
    return yield* exitWith(1)
  }
  const generated = yield* docsFromFiles(files)
  const outDir = outOverride ?? (yield* docsDir)
  const written = yield* writeShowcaseDocs(outDir, generated)
  yield* Console.log(`foldcase docs: wrote ${written.length} doc(s) to ${outDir}`)
  yield* Effect.forEach(written, (doc) => Console.log(`  ${doc.path}`), {
    concurrency: 1,
    discard: true,
  })
})

// Anything but a known subcommand (a typo like `tset`, or none) prints usage to
// stderr and exits non-zero so automation can never pass without running Foldcase.
const printUsage = Console.error(usage).pipe(Effect.andThen(exitWith(1)))

// Split `--flags` from positionals so `--coverage` can sit before or after the
// target (`foldcase test --coverage src` or `foldcase test src --coverage`).
const args = process.argv.slice(2)
const flags = args.filter((arg) => arg.startsWith("--"))
const [subcommand, target, outDir] = args.filter((arg) => !arg.startsWith("--"))
const coverage = flags.includes("--coverage")

// `mcp` is a long-running stdio server (a launchable Layer), not a one-shot
// command, so it dispatches before the exit-code-returning `test`/`docs` paths.
if (subcommand === "mcp") {
  BunRuntime.runMain(Layer.launch(FoldcaseMcpServer))
} else if (subcommand === "test") {
  BunRuntime.runMain(test(target ?? ".", coverage).pipe(Effect.provide(PlatformLive)))
} else if (subcommand === "docs") {
  BunRuntime.runMain(docs(target ?? ".", outDir).pipe(Effect.provide(PlatformLive)))
} else {
  BunRuntime.runMain(printUsage)
}
