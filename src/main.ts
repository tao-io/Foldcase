#!/usr/bin/env node
// foldcase — the Node shell. One of the two per-runtime shells over the
// runtime-agnostic program in `./program` (ADR-0002 › Amendment 1).
//
// A shell does exactly three things: bind a runtime, hand the program the
// argument vector, and write back the exit code. Anything else that appears
// here is logic that belongs in `./program` and is a bug.
//
// The one genuinely Node-shaped concern is loading a consumer's
// `*.showcase.ts`: Node strips types natively but does not rewrite relative
// specifiers, so `./Button` and `./Button.js` in a TypeScript showcase would
// not resolve. That is a property of this runtime, so the fix lives here.

import { registerHooks } from "node:module"

import * as Effect from "effect/Effect"

import { run } from "./program.js"
import { missingPeerNotice } from "./shell/missingPeer.js"
import { resolveTypeScriptSource } from "./shell/nodeResolution.js"

registerHooks({ resolve: resolveTypeScriptSource })

const setExitCode = (code: number): void => {
  process.exitCode = code
}

// The runtime binding is reached for dynamically because `@effect/platform-node`
// is an *optional* peer: a consumer who runs only the Bun bin never installs it.
// A static import fails before a line of this module runs, so the first thing
// such a consumer would see is a loader stack trace. Asking for it here leaves
// room to say which package to install instead — and anything the policy cannot
// explain is rethrown as it came.
const platform = await import("@effect/platform-node").catch((cause: unknown) => {
  const notice = missingPeerNotice(cause, "@effect/platform-node", "foldcase-bun")
  if (notice === undefined) {
    throw cause
  }
  // Not `process.exit`: on macOS a piped stderr is asynchronous, and exiting
  // here would cut the notice off mid-write.
  process.stderr.write(`${notice}\n`)
  process.exitCode = 1
  return undefined
})

if (platform !== undefined) {
  platform.NodeRuntime.runMain(
    run(process.argv.slice(2)).pipe(
      Effect.map(setExitCode),
      Effect.provide(platform.NodeServices.layer),
    ),
  )
}
