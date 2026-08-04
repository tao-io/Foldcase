import { describe, expect, test } from "bun:test"
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { freshRunArgv, FreshRunDocument, FreshSelection } from "./freshRun.js"

// The parent spawns `process.execPath`, so under `bun test` the child is always
// Bun. Node is the other half of the shipped tool and the half with something
// to prove — it strips types but does not rewrite relative specifiers, so a
// showcase importing `./lib/counter` only loads if the child installed the
// resolution hooks. This drives that child directly.
//
// From source, not from `dist/`: a suite that needed a build would be skipped
// in CI, where `test` runs before `build`. The `--import` hook stands in for
// the one thing a compiled child gets for free — its own static imports
// resolving — and installs the very policy the child installs.
const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const child = `${repoRoot}/src/mcp/freshRunChild.ts`
const hooks = `${repoRoot}/test/hooks/typescript-resolution.mjs`
const counter = `${repoRoot}/test/fixtures/counter-logic.showcase.ts`

const platform = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

const TIMEOUT_MS = 30_000

const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(FreshRunDocument))

const runUnderNode = (argv: ReadonlyArray<string>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const handle = yield* spawner.spawn(
          ChildProcess.make("node", ["--import", hooks, child, ...argv], { extendEnv: true }),
        )
        const { exitCode, stderr, stdout } = yield* Effect.all(
          {
            stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
            stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
            exitCode: handle.exitCode,
          },
          { concurrency: "unbounded" },
        )
        return { exitCode: Number(exitCode), stderr, stdout }
      }),
    ).pipe(Effect.provide(platform)),
  )

describe("the fresh run under Node", () => {
  test(
    "loads a showcase's extensionless import and answers one document on stdout",
    async () => {
      const output = await runUnderNode(
        freshRunArgv(FreshSelection.One({ id: "counter/increment" }), [counter]),
      )

      expect(output.exitCode).toBe(0)
      const document = await Effect.runPromise(decodeDocument(output.stdout))
      expect(document._tag).toBe("foldcase/RanShowcase")
      if (document._tag !== "foldcase/RanShowcase") {
        throw new Error("expected a single-Showcase run")
      }
      // The fixture imports `./lib/counter` with no extension — the specifier
      // Node cannot resolve on its own. A pass means the child taught it to.
      expect(document.report.status).toBe("passed")
    },
    TIMEOUT_MS,
  )

  test(
    "exits non-zero, and writes no document, for an argument vector it did not get from the parent",
    async () => {
      const output = await runUnderNode(["Whatever", "counter/increment", counter])

      expect(output.exitCode).not.toBe(0)
      expect(output.stdout.trim()).toBe("")
      expect(output.stderr).toContain("not a fresh-run request")
    },
    TIMEOUT_MS,
  )
})
