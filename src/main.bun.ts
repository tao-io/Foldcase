#!/usr/bin/env bun
// foldcase — the Bun shell. One of the two per-runtime shells over the
// runtime-agnostic program in `./program` (ADR-0002 › Amendment 1).
//
// A shell does exactly three things: bind a runtime, hand the program the
// argument vector, and write back the exit code. Anything else that appears
// here is logic that belongs in `./program` and is a bug.
//
// Bun loads TypeScript and resolves extensionless relative specifiers itself,
// so — unlike the Node shell — there is nothing to teach it about a
// `*.showcase.ts` file.

import * as Effect from "effect/Effect"

import { run } from "./program.js"
import { missingPeerNotice } from "./shell/missingPeer.js"

const setExitCode = (code: number): void => {
  process.exitCode = code
}

// Dynamic for the same reason as the Node shell: `@effect/platform-bun` is an
// optional peer, so a static import would greet a consumer who installed only
// the Node side with a resolver stack trace before this file ran at all.
const platform = await import("@effect/platform-bun").catch((cause: unknown) => {
  const notice = missingPeerNotice(cause, "@effect/platform-bun", "foldcase")
  if (notice === undefined) {
    throw cause
  }
  process.stderr.write(`${notice}\n`)
  process.exitCode = 1
  return undefined
})

if (platform !== undefined) {
  platform.BunRuntime.runMain(
    run(process.argv.slice(2)).pipe(
      Effect.map(setExitCode),
      Effect.provide(platform.BunServices.layer),
    ),
  )
}
