// The fresh run, from the inside: the process `foldcase mcp` spawns to run a
// play against the code that is on disk right now.
//
// It is an entry point, not a module anything imports — the one thing in
// `src/mcp/` that is spawned rather than called. Like the two bins it binds a
// runtime and reads `process.argv`; unlike them it binds no platform Layer,
// because it needs no service the core does not carry: the parent has already
// walked the directory, so this only loads the files it is handed and runs the
// selection over them, through the one loader (ADR-0001).
//
// Its protocol is `./freshRun`: the argument vector on the way in, one JSON
// {@link FreshRunDocument} on stdout on the way out. Anything else it has to
// say goes to stderr, which the parent turns into a warning — stdout carries
// the document and nothing else.

import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { loadShowcasesFromFiles } from "../cli.js"
import { resolveTypeScriptSource } from "../shell/nodeResolution.js"
import { FreshRunDocument, parseFreshRunArgv, runSelection } from "./freshRun.js"

// Node strips TypeScript types but does not rewrite relative specifiers, so a
// showcase importing its component as `./Button` would not resolve — the same
// gap `src/main.ts` fills for the same reason, and with the same policy. The
// runtime that needs it is the runtime that has the API: Bun resolves both
// spellings itself and exposes no `registerHooks`, so the absence of the
// function is the whole test, and nothing here names a runtime.
const { registerHooks } = await import("node:module")
if (registerHooks !== undefined) {
  registerHooks({ resolve: resolveTypeScriptSource })
}

const encodeDocument = Schema.encodeEffect(Schema.fromJsonString(FreshRunDocument))

// The document is the encoded Schema value, so what the parent decodes is the
// contract this module declares. An encode failure would mean the Schema
// disagrees with the report just built — a defect, not a caller's problem.
const answer = (document: FreshRunDocument) =>
  encodeDocument(document).pipe(Effect.orDie, Effect.flatMap(Console.log), Effect.as(0))

const program = Option.match(parseFreshRunArgv(process.argv.slice(2)), {
  // Only the parent spawns this, so an argument vector it did not write is a
  // defect of ours. Say so and exit non-zero: the parent reports the run as
  // failed rather than reading an empty stdout as a verdict.
  onNone: () =>
    Effect.logError(`foldcase: not a fresh-run request: ${process.argv.slice(2).join(" ")}`).pipe(
      Effect.as(1),
    ),
  onSome: ({ files, selection }) =>
    loadShowcasesFromFiles(files).pipe(
      Effect.flatMap((load) => runSelection(load, selection)),
      Effect.flatMap(answer),
    ),
})

// Logs go to stderr because stdout carries the document, exactly as the MCP
// server reserves its own stdout for the protocol.
process.exitCode = await Effect.runPromise(
  program.pipe(Effect.provide(Layer.succeed(Logger.LogToStderr)(true))),
)
