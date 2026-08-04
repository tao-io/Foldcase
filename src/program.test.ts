import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"

import { Command, parseCommand, run } from "./program.js"

const fixtures = `${import.meta.dir}/../test/fixtures`
// The program resolves its target, so a report names a normalized path — these
// two are compared against one and carry no `..` for that reason.
const resolved = new URL("../test", import.meta.url).pathname
const malformed = `${resolved}/malformed`

// The program is runtime-agnostic; the suite runs it on the Bun platform, the
// same way `src/main.bun.ts` does.
const exitCodeOf = (argv: ReadonlyArray<string>): Promise<number> =>
  Effect.runPromise(run(argv).pipe(Effect.provide(BunServices.layer)))

/** A run with its two streams kept apart, so a test can say which carried what. */
interface Run {
  readonly code: number
  readonly out: ReadonlyArray<string>
  readonly err: ReadonlyArray<string>
}

// `--json` is a promise about *stdout*, so the test has to see the streams
// separately. The Console service is the seam: the program writes through it,
// and here it writes into two arrays instead of the terminal.
const runCapturing = async (argv: ReadonlyArray<string>): Promise<Run> => {
  const out: Array<string> = []
  const err: Array<string> = []
  const capturing: Console.Console = {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => out.push(args.join(" ")),
    error: (...args: ReadonlyArray<unknown>) => err.push(args.join(" ")),
  }
  const code = await Effect.runPromise(
    run(argv).pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(Console.Console)(capturing), BunServices.layer)),
    ),
  )
  return { code, out, err }
}

/** The one JSON document a `--json` run is allowed to print. */
const documentOf = (result: Run): unknown => {
  expect(result.out).toHaveLength(1)
  return JSON.parse(result.out[0] ?? "")
}

describe("parseCommand", () => {
  test("reads `test`, with the target defaulting to the current directory", () => {
    expect(parseCommand(["test"])).toEqual(
      Command.Test({ target: ".", coverage: false, json: false }),
    )
    expect(parseCommand(["test", "src/ui"])).toEqual(
      Command.Test({ target: "src/ui", coverage: false, json: false }),
    )
  })

  test("accepts --coverage on either side of the target", () => {
    const expected = Command.Test({ target: "src/ui", coverage: true, json: false })
    expect(parseCommand(["test", "--coverage", "src/ui"])).toEqual(expected)
    expect(parseCommand(["test", "src/ui", "--coverage"])).toEqual(expected)
  })

  test("accepts --json on either side of the target, like --coverage", () => {
    const expected = Command.Test({ target: "src/ui", coverage: false, json: true })
    expect(parseCommand(["test", "--json", "src/ui"])).toEqual(expected)
    expect(parseCommand(["test", "src/ui", "--json"])).toEqual(expected)
    expect(parseCommand(["test", "--json", "--coverage", "src/ui"])).toEqual(
      Command.Test({ target: "src/ui", coverage: true, json: true }),
    )
  })

  test("reads `docs`, with an optional output directory", () => {
    expect(parseCommand(["docs"])).toEqual(
      Command.Docs({ target: ".", outDir: Option.none(), json: false, check: false }),
    )
    expect(parseCommand(["docs", "src/ui", "out"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.some("out"), json: false, check: false }),
    )
    expect(parseCommand(["docs", "--json", "src/ui"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.none(), json: true, check: false }),
    )
  })

  test("reads --check for `docs`, on either side of the target and beside --json", () => {
    const expected = Command.Docs({
      target: "src/ui",
      outDir: Option.some("out"),
      json: false,
      check: true,
    })
    expect(parseCommand(["docs", "--check", "src/ui", "out"])).toEqual(expected)
    expect(parseCommand(["docs", "src/ui", "out", "--check"])).toEqual(expected)
    expect(parseCommand(["docs", "--json", "--check", "src/ui"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.none(), json: true, check: true }),
    )
  })

  test("refuses --check for `test`, which has nothing on disk to compare", () => {
    expect(parseCommand(["test", "src/ui", "--check"])).toEqual(
      Command.Usage({
        reason: Option.some("test takes --coverage and --json; it did not understand: --check"),
      }),
    )
  })

  test("refuses a second target for `test`, naming the argument it dropped", () => {
    // Silently dropping it ran the first catalog, exited 0, and said nothing
    // about the second — a CI job asking for two catalogs passed forever.
    expect(parseCommand(["test", "a.showcase.ts", "b.showcase.ts"])).toEqual(
      Command.Usage({
        reason: Option.some("test takes one target; it did not understand: b.showcase.ts"),
      }),
    )
  })

  test("refuses a flag `test` does not know, naming it", () => {
    // A misspelled flag used to be dropped in silence: `--covrage` ran the
    // suite without coverage and exited 0, so the typo looked like a pass.
    expect(parseCommand(["test", "src/ui", "--covrage"])).toEqual(
      Command.Usage({
        reason: Option.some("test takes --coverage and --json; it did not understand: --covrage"),
      }),
    )
  })

  test("refuses a third positional for `docs`, whose second one is the out-dir", () => {
    expect(parseCommand(["docs", "src/ui", "out", "extra"])).toEqual(
      Command.Usage({
        reason: Option.some("docs takes a target and an out-dir; it did not understand: extra"),
      }),
    )
  })

  test("refuses --coverage for `docs`, which collects none", () => {
    expect(parseCommand(["docs", "src/ui", "--coverage"])).toEqual(
      Command.Usage({
        reason: Option.some("docs takes --json and --check; it did not understand: --coverage"),
      }),
    )
  })

  test("refuses every flag for `mcp`, which takes none, and names them all", () => {
    expect(parseCommand(["mcp", "--json", "--coverage"])).toEqual(
      Command.Usage({
        reason: Option.some("mcp takes no flags; it did not understand: --json, --coverage"),
      }),
    )
  })

  test("refuses a target for `mcp`, which reads its catalog over the protocol", () => {
    expect(parseCommand(["mcp", "src/ui"])).toEqual(
      Command.Usage({
        reason: Option.some("mcp takes no target; it did not understand: src/ui"),
      }),
    )
  })

  test("reads `mcp`, and calls anything else usage", () => {
    expect(parseCommand(["mcp"])).toEqual(Command.Mcp())
    // Nothing to name here: the banner is the whole answer.
    const bare = Command.Usage({ reason: Option.none() })
    expect(parseCommand(["tset"])).toEqual(bare)
    expect(parseCommand([])).toEqual(bare)
    expect(parseCommand(["--coverage"])).toEqual(bare)
  })
})

describe("run", () => {
  test("returns the suite verdict as an exit code instead of touching the process", async () => {
    // The fixture catalog contains a deliberately failing Showcase.
    expect(await exitCodeOf(["test", fixtures])).toBe(1)
  })

  test("a directory with no Showcases is a failure, not an empty pass", async () => {
    expect(await exitCodeOf(["test", `${import.meta.dir}/../docs`])).toBe(1)
  })

  test("an unknown subcommand exits non-zero", async () => {
    expect(await exitCodeOf(["tset"])).toBe(1)
  })

  test("a second target exits non-zero, and stderr names the one not understood", async () => {
    const result = await runCapturing([
      "test",
      `${fixtures}/counter-logic.showcase.ts`,
      `${malformed}/bad-message.showcase.ts`,
    ])

    expect(result.code).toBe(1)
    // Nothing ran, so nothing may look like a result on stdout.
    expect(result.out).toEqual([])
    const said = result.err.join("\n")
    expect(said).toContain("did not understand: ")
    expect(said).toContain(`${malformed}/bad-message.showcase.ts`)
    expect(said).toContain("usage: foldcase")
  })

  test("a misspelled flag exits non-zero instead of running without it", async () => {
    const result = await runCapturing([
      "test",
      `${fixtures}/counter-logic.showcase.ts`,
      "--covrage",
    ])

    // The catalog passes, so a run that ignored the typo would exit 0 and print
    // a green summary — the flag has to be refused before anything runs.
    expect(result.code).toBe(1)
    expect(result.out).toEqual([])
    const said = result.err.join("\n")
    expect(said).toContain("did not understand: --covrage")
    expect(said).toContain("usage: foldcase")
  })

  test("docs writes its autodocs and exits clean", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs`
    expect(await exitCodeOf(["docs", `${fixtures}/schema.showcase.ts`, out])).toBe(0)
    await Bun.$`rm -rf ${out}`.quiet()
  })

  test("a directory holding an unloadable module still runs the rest of it", async () => {
    // `test/malformed` holds only files that will not load; running the whole
    // of `test/` mixes them with the working fixtures. One bad module used to
    // abort the process before any of the good ones were attempted.
    expect(await exitCodeOf(["test", `${import.meta.dir}/../test`])).toBe(1)
  })

  test("test --json prints the suite report, and only that, on stdout", async () => {
    const result = await runCapturing(["test", "--json", `${fixtures}/sample.showcase.ts`])

    // The verdict is unchanged: the fixture holds a failing Showcase.
    expect(result.code).toBe(1)
    expect(documentOf(result)).toEqual({
      suite: {
        total: 2,
        passed: 1,
        failed: 1,
        reports: [
          { id: "sample/passes", status: "passed", file: `${resolved}/fixtures/sample.showcase.ts` },
          {
            id: "sample/fails",
            status: "failed",
            error: {
              name: "Error",
              message: "sample assertion failed",
              stack: expect.any(String),
            },
            file: `${resolved}/fixtures/sample.showcase.ts`,
          },
        ],
      },
    })
  })

  test("test --json --coverage puts the coverage in the same document", async () => {
    const result = await runCapturing([
      "test",
      "--json",
      "--coverage",
      `${fixtures}/counter-logic.showcase.ts`,
    ])

    expect(result.code).toBe(0)
    const document = documentOf(result) as {
      suite: { total: number }
      coverage?: { showcases: ReadonlyArray<{ id: string }>; files: ReadonlyArray<unknown> }
    }
    expect(document.suite.total).toBe(1)
    expect(document.coverage?.showcases.map((showcase) => showcase.id)).toEqual([
      "counter/increment",
    ])
    expect(document.coverage?.files.length).toBeGreaterThan(0)
  })

  test("test --json reports a file that will not load, and keeps stdout clean", async () => {
    const result = await runCapturing(["test", "--json", malformed])

    expect(result.code).toBe(1)
    const document = documentOf(result) as {
      suite: { reports: ReadonlyArray<{ id: string; file: string }> }
    }
    expect(document.suite.reports.map((report) => report.file)).toEqual([
      `${malformed}/bad-message.showcase.ts`,
      `${malformed}/broken-import.showcase.ts`,
    ])
  })

  test("--json over a directory with no Showcases prints no document", async () => {
    const result = await runCapturing(["test", "--json", `${import.meta.dir}/../docs`])

    // Nothing ran, so there is no report to print — a document saying `0 failed`
    // would read as a clean run. The reason goes to stderr, the verdict to the
    // exit code.
    expect(result.code).toBe(1)
    expect(result.out).toEqual([])
    expect(result.err.join("\n")).toContain("no *.showcase.ts found")
  })

  test("docs --json names the documents it wrote", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-json`
    const result = await runCapturing([
      "docs",
      "--json",
      `${fixtures}/schema.showcase.ts`,
      out,
    ])

    expect(result.code).toBe(0)
    expect(documentOf(result)).toEqual({
      docs: [
        {
          component: "counter",
          path: `${new URL("../runtime-test-docs-json", import.meta.url).pathname}/counter.md`,
        },
      ],
      failures: [],
    })
    await Bun.$`rm -rf ${out}`.quiet()
  })

  test("docs --json names the files that would not load, and still exits non-zero", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-json-partial`
    const result = await runCapturing(["docs", "--json", malformed, out])

    expect(result.code).toBe(1)
    const document = documentOf(result) as {
      docs: ReadonlyArray<unknown>
      failures: ReadonlyArray<{ path: string; reason: string }>
    }
    expect(document.docs).toEqual([])
    expect(document.failures.map((failure) => failure.path)).toEqual([
      `${malformed}/bad-message.showcase.ts`,
      `${malformed}/broken-import.showcase.ts`,
    ])
    expect(document.failures[0]?.reason.length).toBeGreaterThan(0)
    await Bun.$`rm -rf ${out}`.quiet()
  })

  test("docs --check exits 0 when the out-dir already holds what this run would write", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-check`
    expect(await exitCodeOf(["docs", `${fixtures}/schema.showcase.ts`, out])).toBe(0)

    const result = await runCapturing(["docs", "--check", `${fixtures}/schema.showcase.ts`, out])

    expect(result.code).toBe(0)
    expect(result.out.join("\n")).toContain("1 doc(s) up to date")
    await Bun.$`rm -rf ${out}`.quiet()
  })

  test("docs --check exits 1 on a document the out-dir lacks, and writes nothing", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-check-missing`
    await Bun.$`rm -rf ${out}`.quiet()
    const result = await runCapturing(["docs", "--check", `${fixtures}/schema.showcase.ts`, out])

    // The gate's whole job: a stale tree fails CI without being repaired
    // underneath the check, which would make the next run pass for no reason.
    expect(result.code).toBe(1)
    const said = result.out.join("\n")
    expect(said).toContain("1 of 1 doc(s) would change")
    // The path is the resolved one, as `docs` reports a written page.
    expect(said).toContain(
      `${new URL("../runtime-test-docs-check-missing", import.meta.url).pathname}/counter.md — missing`,
    )
    expect(await Bun.file(`${out}/counter.md`).exists()).toBe(false)
  })

  test("docs --check --json puts the drift in the document, and stdout carries only it", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-check-json`
    await Bun.$`rm -rf ${out}`.quiet()
    const result = await runCapturing([
      "docs",
      "--check",
      "--json",
      `${fixtures}/schema.showcase.ts`,
      out,
    ])

    expect(result.code).toBe(1)
    const document = documentOf(result) as {
      docs: ReadonlyArray<unknown>
      stale: ReadonlyArray<{ component: string; path: string; reason: string }>
    }
    // Nothing was written, so nothing may claim to have been.
    expect(document.docs).toEqual([])
    expect(document.stale).toEqual([
      { component: "counter", path: `${new URL("../runtime-test-docs-check-json", import.meta.url).pathname}/counter.md`, reason: "missing" },
    ])
    // The human line is a diagnostic here, and diagnostics leave stdout alone.
    expect(result.err.join("\n")).toContain("would change")
  })

  test("docs over an unloadable module writes what it can and exits non-zero", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-partial`
    expect(
      await exitCodeOf(["docs", `${import.meta.dir}/../test/malformed`, out]),
    ).toBe(1)
    await Bun.$`rm -rf ${out}`.quiet()
  })
})
