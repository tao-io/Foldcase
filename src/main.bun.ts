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

import { BunRuntime, BunServices } from "@effect/platform-bun"
import * as Effect from "effect/Effect"

import { run } from "./program"

const setExitCode = (code: number): void => {
  process.exitCode = code
}

BunRuntime.runMain(
  run(process.argv.slice(2)).pipe(Effect.map(setExitCode), Effect.provide(BunServices.layer)),
)
