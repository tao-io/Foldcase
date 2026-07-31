import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

import { Command, parseCommand, run } from "./program.js"

const fixtures = `${import.meta.dir}/../test/fixtures`

// The program is runtime-agnostic; the suite runs it on the Bun platform, the
// same way `src/main.bun.ts` does.
const exitCodeOf = (argv: ReadonlyArray<string>): Promise<number> =>
  Effect.runPromise(run(argv).pipe(Effect.provide(BunServices.layer)))

describe("parseCommand", () => {
  test("reads `test`, with the target defaulting to the current directory", () => {
    expect(parseCommand(["test"])).toEqual(Command.Test({ target: ".", coverage: false }))
    expect(parseCommand(["test", "src/ui"])).toEqual(
      Command.Test({ target: "src/ui", coverage: false }),
    )
  })

  test("accepts --coverage on either side of the target", () => {
    const expected = Command.Test({ target: "src/ui", coverage: true })
    expect(parseCommand(["test", "--coverage", "src/ui"])).toEqual(expected)
    expect(parseCommand(["test", "src/ui", "--coverage"])).toEqual(expected)
  })

  test("reads `docs`, with an optional output directory", () => {
    expect(parseCommand(["docs"])).toEqual(
      Command.Docs({ target: ".", outDir: Option.none() }),
    )
    expect(parseCommand(["docs", "src/ui", "out"])).toEqual(
      Command.Docs({ target: "src/ui", outDir: Option.some("out") }),
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

  test("docs over an unloadable module writes what it can and exits non-zero", async () => {
    const out = `${import.meta.dir}/../runtime-test-docs-partial`
    expect(
      await exitCodeOf(["docs", `${import.meta.dir}/../test/malformed`, out]),
    ).toBe(1)
    await Bun.$`rm -rf ${out}`.quiet()
  })
})
