import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

import { loadShowcasesFromFiles } from "../cli.js"
import {
  FreshSelection,
  freshRunArgv,
  parseFreshRunArgv,
  runSelection,
} from "./freshRun.js"

const testDir = new URL("../../test", import.meta.url).pathname.replace(/\/$/, "")
const fixtures = `${testDir}/fixtures`

const documentFor = (selection: FreshSelection, files: ReadonlyArray<string>) =>
  Effect.runPromise(
    loadShowcasesFromFiles(files).pipe(Effect.flatMap((load) => runSelection(load, selection))),
  )

describe("the fresh-run argument vector", () => {
  test("carries a selection and its files there and back", () => {
    const files = ["/tmp/a.ts", "/tmp/b.ts"]
    const selections = [
      FreshSelection.One({ id: "counter/increment" }),
      FreshSelection.Under({ prefix: "counter/" }),
      FreshSelection.Every(),
    ]

    for (const selection of selections) {
      expect(parseFreshRunArgv(freshRunArgv(selection, files))).toEqual(
        Option.some({ selection, files }),
      )
    }
  })

  test("survives an id that looks like a flag, and a catalog with no files", () => {
    const selection = FreshSelection.One({ id: "--not-a-flag" })
    expect(parseFreshRunArgv(freshRunArgv(selection, []))).toEqual(
      Option.some({ selection, files: [] }),
    )
  })

  test("refuses an argument vector it did not write", () => {
    expect(parseFreshRunArgv([])).toEqual(Option.none())
    expect(parseFreshRunArgv(["Some", "id"])).toEqual(Option.none())
    // A mode with no selector word at all: the child was handed half a request.
    expect(parseFreshRunArgv(["One"])).toEqual(Option.none())
  })
})

describe("running a selection over a loaded catalog", () => {
  const sample = `${fixtures}/sample.showcase.ts`

  test("answers one report for one id, naming the file it came from", async () => {
    const document = await documentFor(FreshSelection.One({ id: "sample/fails" }), [sample])

    expect(document._tag).toBe("foldcase/RanShowcase")
    if (document._tag !== "foldcase/RanShowcase") {
      throw new Error("expected a single-Showcase run")
    }
    // A failing play is data here, exactly as it is for `foldcase test`.
    expect(document.report.status).toBe("failed")
    expect(document.report.file).toBe(sample)
  })

  test("answers the available ids for an id nothing declares", async () => {
    const document = await documentFor(FreshSelection.One({ id: "sample/gone" }), [sample])

    expect(document._tag).toBe("foldcase/NoSuchShowcase")
    if (document._tag !== "foldcase/NoSuchShowcase") {
      throw new Error("expected a missing-Showcase answer")
    }
    expect(document.available).toEqual(["sample/passes", "sample/fails"])
  })

  test("answers one suite for a prefix, and only the Showcases under it", async () => {
    const files = [sample, `${fixtures}/schema.showcase.ts`]
    const document = await documentFor(FreshSelection.Under({ prefix: "counter/" }), files)

    expect(document._tag).toBe("foldcase/RanSuite")
    if (document._tag !== "foldcase/RanSuite") {
      throw new Error("expected a suite run")
    }
    expect(document.suite.reports.map((report) => report.id)).toEqual(["counter/schema"])
  })

  test("answers the available ids for a prefix nothing starts with", async () => {
    const document = await documentFor(FreshSelection.Under({ prefix: "nope/" }), [sample])

    expect(document._tag).toBe("foldcase/NoSuchPrefix")
    if (document._tag !== "foldcase/NoSuchPrefix") {
      throw new Error("expected a missing-prefix answer")
    }
    expect(document.prefix).toBe("nope/")
    expect(document.available).toEqual(["sample/passes", "sample/fails"])
  })

  test("folds a file that would not load into the whole-catalog suite", async () => {
    const files = [sample, `${testDir}/malformed/bad-message.showcase.ts`]
    const document = await documentFor(FreshSelection.Every(), files)

    expect(document._tag).toBe("foldcase/RanSuite")
    if (document._tag !== "foldcase/RanSuite") {
      throw new Error("expected a suite run")
    }
    // The verdict `foldcase test` gives: the file is a failed entry ahead of
    // the plays, so the suite is non-zero and says which file to open.
    expect(document.suite.reports[0]?.id).toContain("bad-message.showcase.ts")
    expect(document.suite.failed).toBeGreaterThan(0)
  })
})
