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
      Command.Docs({ target: ".", outDir: Option.none(), json: false }),
    )
    expect(parseCommand(["docs", "src/ui", "out"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.some("out"), json: false }),
    )
    expect(parseCommand(["docs", "--json", "src/ui"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.none(), json: true }),
    )
  })

  test("reads `mcp`, and calls anything else usage", () => {
    expect(parseCommand(["mcp"])).toEqual(Command.Mcp())
    expect(parseCommand(["tset"])).toEqual(Command.Usage())
    expect(parseCommand([])).toEqual(Command.Usage())
    expect(parseCommand(["--coverage"])).toEqual(Command.Usage())
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
          component: "counter/schema",
          path: `${new URL("../runtime-test-docs-json", import.meta.url).pathname}/counter-schema.md`,
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

  test("docs over an unloadable module writes what it can and exits non-zero", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-partial`
    expect(
      await exitCodeOf(["docs", `${import.meta.dir}/../test/malformed`, out]),
    ).toBe(1)
    await Bun.$`rm -rf ${out}`.quiet()
  })
})
