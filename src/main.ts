#!/usr/bin/env bun
// foldcase — the typed self-healing test loop CLI. This is the imperative shell:
// the one place platform layers are provided and argv/stdout/exit are touched.
// All logic lives behind `./cli` + `./runner`, tested through `bun test`.

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { discoverShowcaseFiles, docsFromFiles, runSuiteFromFiles } from "./cli"
import { writeShowcaseDocs } from "./docs/generate"
import { FoldcaseMcpServer } from "./mcp/server"
import { formatSuite, suiteExitCode } from "./runner"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const usage =
  "usage: foldcase <test [dir-or-file] | docs [dir] [out-dir] | mcp>   (test/docs default to the current directory; docs writes Schema-table Markdown to out-dir, default FOLDCASE_DOCS_DIR; mcp serves the catalog over stdio)"

// The default output directory for `foldcase docs`, overridable by the second
// positional argument. Read via Config (the sanctioned env path at the shell).
const docsDir = Config.string("FOLDCASE_DOCS_DIR").pipe(Config.withDefault("foldcase-docs"))

// A single place to set the process exit code. Non-zero must mean "did not run
// clean" so CI never green-lights a run that discovered nothing or misfired.
const exitWith = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code
  })

const resolveFiles = Effect.fn("foldcase.resolveFiles")(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const resolved = path.resolve(target)
  const info = yield* fs.stat(resolved)
  if (info.type === "Directory") {
    return yield* discoverShowcaseFiles(resolved)
  }
  return [resolved]
})

const test = Effect.fn("foldcase.test")(function* (target: string) {
  const files = yield* resolveFiles(target)
  // Discovering zero showcases is a failure, not an empty pass: an exit-0 with no
  // coverage reads as "everything passed" and green-lights a misconfigured CI run.
  if (Arr.isReadonlyArrayEmpty(files)) {
    yield* Console.error(`foldcase: no *.showcase.ts found under ${target}`)
    return yield* exitWith(1)
  }
  const suite = yield* runSuiteFromFiles(files)
  yield* Console.log(formatSuite(suite))
  return yield* exitWith(suiteExitCode(suite))
})

const docs = Effect.fn("foldcase.docs")(function* (target: string, outOverride?: string) {
  const files = yield* resolveFiles(target)
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

const [, , subcommand, target, outDir] = process.argv

// `mcp` is a long-running stdio server (a launchable Layer), not a one-shot
// command, so it dispatches before the exit-code-returning `test`/`docs` paths.
if (subcommand === "mcp") {
  BunRuntime.runMain(Layer.launch(FoldcaseMcpServer))
} else if (subcommand === "test") {
  BunRuntime.runMain(test(target ?? ".").pipe(Effect.provide(PlatformLive)))
} else if (subcommand === "docs") {
  BunRuntime.runMain(docs(target ?? ".", outDir).pipe(Effect.provide(PlatformLive)))
} else {
  BunRuntime.runMain(printUsage)
}
