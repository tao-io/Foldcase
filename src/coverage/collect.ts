import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import type { Showcase } from "../runner"
import { RawCoverage } from "./coverage"
import { buildCoverageReport } from "./report"

/**
 * `foldcase test --coverage` could not collect V8 coverage: Node was missing or
 * failed, or its output was not decodable {@link RawCoverage}. Tagged so the CLI
 * can degrade coverage to a best-effort warning without failing the test run.
 */
export class CoverageCollectionError extends Schema.TaggedErrorClass<CoverageCollectionError>()(
  "foldcase/CoverageCollectionError",
  { reason: Schema.String },
) {}

// The Node instrument that does the actual precise-coverage collection. Resolved
// next to this module so `bun run`/`mise` find it on disk (a compiled binary
// would need it shipped alongside — `--coverage` runs from source, as the gates
// do).
const collectorPath = `${import.meta.dir}/collector.mjs`

const decodeRaw = Schema.decodeUnknownEffect(Schema.fromJsonString(RawCoverage))

/**
 * Run every Showcase file under Node with V8 precise coverage and build a
 * {@link CoverageReport}. Node is required (Bun has no programmatic precise
 * coverage); `rootDir` scopes coverage to the Showcase sources under test.
 *
 * `showcases` is the catalog already loaded by the one loader (ADR-0001): the
 * report's per-Showcase breakdown is a projection of those records, so the
 * collector's process-boundary re-import can only *attribute* coverage, never
 * decide which Showcases exist.
 */
export const collectCoverage = Effect.fn("foldcase.coverage.collectCoverage")(function* (
  rootDir: string,
  files: ReadonlyArray<string>,
  showcases: ReadonlyArray<Showcase>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const command = ChildProcess.make("node", [collectorPath, rootDir, ...files], {
    extendEnv: true,
  })

  const output = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command)
      const { stdout, stderr, exitCode } = yield* Effect.all(
        {
          stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
          stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
          exitCode: handle.exitCode,
        },
        { concurrency: "unbounded" },
      )
      return { stdout, stderr, exitCode: Number(exitCode) }
    }),
  ).pipe(
    // A spawn-level failure (Node not on PATH) is a coverage-collection failure,
    // not a defect — normalize the cause into the typed error.
    Effect.mapError(
      (cause) => new CoverageCollectionError({ reason: `node spawn failed: ${String(cause)}` }),
    ),
  )

  if (output.exitCode !== 0) {
    return yield* new CoverageCollectionError({
      reason: `collector exited ${output.exitCode}: ${output.stderr.trim()}`,
    })
  }

  // The collector exits 0 even when it skips an unimportable Showcase (best
  // effort), reporting the skip on stderr — surface it so a silently-missing
  // Showcase is visible rather than a quietly partial report.
  if (output.stderr.trim() !== "") {
    yield* Effect.logWarning(`foldcase coverage: ${output.stderr.trim()}`)
  }

  const raw = yield* decodeRaw(output.stdout).pipe(
    Effect.mapError(
      (cause) => new CoverageCollectionError({ reason: `undecodable coverage output: ${cause}` }),
    ),
  )
  return yield* buildCoverageReport(raw, showcases).pipe(
    Effect.mapError(
      (cause) =>
        new CoverageCollectionError({ reason: `could not read a covered source: ${String(cause)}` }),
    ),
  )
})
