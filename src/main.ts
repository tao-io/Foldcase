#!/usr/bin/env bun
// foldcase — the typed self-healing test loop CLI. This is the imperative shell:
// the one place platform layers are provided and argv/stdout/exit are touched.
// All logic lives behind `./cli` + `./runner`, tested through `bun test`.

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { discoverShowcaseFiles, runSuiteFromFiles } from "./cli"
import { formatSuite, suiteExitCode } from "./runner"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const usage = "usage: foldcase test [dir-or-file]   (defaults to the current directory)"

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
  const suite = yield* runSuiteFromFiles(files)
  yield* Console.log(formatSuite(suite))
  yield* Effect.sync(() => {
    process.exitCode = suiteExitCode(suite)
  })
})

const main = Effect.fn("foldcase.main")(function* () {
  const [, , subcommand, target] = process.argv
  if (subcommand !== "test") {
    return yield* Console.log(usage)
  }
  return yield* test(target ?? ".")
})

BunRuntime.runMain(main().pipe(Effect.provide(PlatformLive)))
