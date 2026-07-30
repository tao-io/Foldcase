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

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import * as Effect from "effect/Effect"

import { run } from "./program.js"
import { resolveTypeScriptSource } from "./shell/nodeResolution.js"

registerHooks({ resolve: resolveTypeScriptSource })

const setExitCode = (code: number): void => {
  process.exitCode = code
}

NodeRuntime.runMain(
  run(process.argv.slice(2)).pipe(Effect.map(setExitCode), Effect.provide(NodeServices.layer)),
)
