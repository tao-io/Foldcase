import { describe, expect, test } from "bun:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Tool } from "effect/unstable/ai"

import type { Showcase } from "../runner.js"
import { makeCatalog } from "./catalog.js"
import { FoldcaseToolkit, makeHandlers } from "./tools.js"

const passing: Showcase = { id: "sample/passes", play: () => {} }
const withSchema: Showcase = {
  id: "sample/with-schema",
  play: () => {},
  message: Schema.TaggedStruct("Clicked", {}),
  model: Schema.Struct({ count: Schema.Number }),
}

describe("FoldcaseToolkit", () => {
  test("exposes exactly the catalog verbs", () => {
    const names = Object.keys(FoldcaseToolkit.tools)
    expect(names).toHaveLength(6)
    expect(names).toEqual(
      expect.arrayContaining([
        "foldcase_get_showcase_model_schema",
        "foldcase_get_showcase_schema",
        "foldcase_list_showcases",
        "foldcase_load_catalog",
        "foldcase_run_catalog",
        "foldcase_run_showcase",
      ]),
    )
  })

  test("an optional parameter is one an agent may omit, not one it may null", () => {
    // The published input schema is the only thing an agent has to go on. A
    // `null` branch in it is an invitation the decoder then refuses, so the
    // optional parameters are exact-optional keys: send a string, or nothing.
    const withOptionalParameters = [
      FoldcaseToolkit.tools.foldcase_run_catalog,
      FoldcaseToolkit.tools.foldcase_load_catalog,
    ]
    for (const tool of withOptionalParameters) {
      expect([tool.name, JSON.stringify(Tool.getJsonSchema(tool)).includes("null")]).toEqual([
        tool.name,
        false,
      ])
    }
  })

  test("says which answers come from disk and which can be stale", () => {
    // The descriptions are the only thing an agent reads before it calls, so
    // they carry the one asymmetry in this server: a run re-reads the files in
    // a child process, while the listing and the two schema verbs answer from
    // the catalog this process imported — and an imported module is cached by
    // URL, so an edited file's Schemas stay as they were until a restart.
    const { tools } = FoldcaseToolkit
    for (const tool of [tools.foldcase_run_showcase, tools.foldcase_run_catalog]) {
      expect([tool.name, tool.description?.includes("from disk")]).toEqual([tool.name, true])
    }
    for (const tool of [
      tools.foldcase_list_showcases,
      tools.foldcase_get_showcase_schema,
      tools.foldcase_get_showcase_model_schema,
      tools.foldcase_load_catalog,
    ]) {
      expect([tool.name, tool.description?.includes("restart")]).toEqual([tool.name, true])
    }
  })

  test("the listing verb says what a gap is, and what to do about one", () => {
    // `gaps` is the field an agent is meant to act on — a listed `undispatched`
    // tag is a Showcase nobody has written — and a field a description does not
    // mention is a field no agent reads.
    const description = FoldcaseToolkit.tools.foldcase_list_showcases.description ?? ""

    expect(description).toContain("gaps")
    expect(description).toContain("undispatched")
    expect(description).toContain("unknown")
    expect(description).toContain("write a Showcase")
  })

  test("every verb is annotated read-only, non-destructive and closed-world", () => {
    // The three verbs read the declared catalog and run a `play` in-process.
    // Effect's defaults are the opposite (`destructiveHint: true`,
    // `readOnlyHint: false`, `openWorldHint: true`), and an MCP host reads those
    // hints to decide whether a tool needs confirmation — so an unannotated
    // Foldcase tool asks the user's permission to read a file listing.
    for (const tool of Object.values(FoldcaseToolkit.tools)) {
      expect([tool.name, Context.get(tool.annotations, Tool.Readonly)]).toEqual([tool.name, true])
      expect([tool.name, Context.get(tool.annotations, Tool.Destructive)]).toEqual([
        tool.name,
        false,
      ])
      expect([tool.name, Context.get(tool.annotations, Tool.OpenWorld)]).toEqual([tool.name, false])
    }
  })
})

describe("foldcase mcp handlers", () => {
  const handlers = makeHandlers(Effect.runSync(makeCatalog([passing, withSchema])))

  test("foldcase_list_showcases returns the catalog listing", async () => {
    const listing = await Effect.runPromise(handlers.foldcase_list_showcases({}))

    expect(listing.showcases.map((entry) => entry.id)).toEqual([
      "sample/passes",
      "sample/with-schema",
    ])
  })

  test("foldcase_get_showcase_schema introspects a Showcase's Message schema", async () => {
    const result = await Effect.runPromise(
      handlers.foldcase_get_showcase_schema({ showcase_id: "sample/with-schema" }),
    )

    expect(result.id).toBe("sample/with-schema")
    expect(JSON.stringify(result.jsonSchema)).toContain("Clicked")
  })

  test("foldcase_get_showcase_model_schema introspects a Showcase's Model schema", async () => {
    const result = await Effect.runPromise(
      handlers.foldcase_get_showcase_model_schema({ showcase_id: "sample/with-schema" }),
    )

    expect(result.id).toBe("sample/with-schema")
    expect(JSON.stringify(result.jsonSchema)).toContain("count")
  })

  test("foldcase_get_showcase_schema still answers with the Message schema", async () => {
    // The published verb keeps its meaning: the Showcase declares both, and
    // this one returns the Message. Nothing about its answer moved.
    const result = await Effect.runPromise(
      handlers.foldcase_get_showcase_schema({ showcase_id: "sample/with-schema" }),
    )

    expect(JSON.stringify(result.jsonSchema)).toContain("Clicked")
  })

  test("foldcase_run_showcase runs the play and reports pass/fail", async () => {
    const report = await Effect.runPromise(
      handlers.foldcase_run_showcase({ showcase_id: "sample/passes" }),
    )

    expect(report.id).toBe("sample/passes")
    expect(report.status).toBe("passed")
  })

  test("foldcase_run_catalog runs every Showcase into one suite report", async () => {
    const suite = await Effect.runPromise(handlers.foldcase_run_catalog({}))

    expect([suite.total, suite.passed, suite.failed]).toEqual([2, 2, 0])
  })

  test("foldcase_run_catalog narrows to an id prefix", async () => {
    const suite = await Effect.runPromise(
      handlers.foldcase_run_catalog({ id_prefix: "sample/with-" }),
    )

    expect(suite.reports.map((report) => report.id)).toEqual(["sample/with-schema"])
  })

  test("foldcase_load_catalog reports what the re-read found", async () => {
    // An in-memory catalog has no directory behind it, so it re-serves what it
    // holds; that a call with no `dir` reaches the catalog at all is the part
    // this pins down. The disk behaviour is in catalog.load.test.ts.
    const report = await Effect.runPromise(handlers.foldcase_load_catalog({}))

    expect(report.showcaseCount).toBe(2)
    expect(report.failures).toEqual([])
  })
})
