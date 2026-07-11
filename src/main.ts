#!/usr/bin/env bun
// foldcase — the typed self-healing test loop CLI. This is the imperative shell:
// the one place platform layers are provided and argv/stdout/exit are touched.
// All logic lives behind `./cli` + `./runner`, tested through `bun test`.

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun"
import * as Arr from "effect/Array"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { discoverShowcaseFiles, runSuiteFromFiles } from "./cli"
import { FoldcaseMcpServer } from "./mcp/server"
import { formatSuite, suiteExitCode } from "./runner"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const usage =
  "usage: foldcase <test [dir-or-file] | mcp>   (test defaults to the current directory; mcp serves the catalog over stdio)"

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

// Anything but a known subcommand (a typo like `tset`, or none) prints usage to
// stderr and exits non-zero so automation can never pass without running Foldcase.
const printUsage = Console.error(usage).pipe(Effect.andThen(exitWith(1)))

const [, , subcommand, target] = process.argv

// `mcp` is a long-running stdio server (a launchable Layer), not a one-shot
// command, so it dispatches before the exit-code-returning `test` path.
if (subcommand === "mcp") {
  BunRuntime.runMain(Layer.launch(FoldcaseMcpServer))
} else if (subcommand === "test") {
  BunRuntime.runMain(test(target ?? ".").pipe(Effect.provide(PlatformLive)))
} else {
  BunRuntime.runMain(printUsage)
}
