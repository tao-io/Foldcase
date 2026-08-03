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
}

describe("FoldcaseToolkit", () => {
  test("exposes exactly the three catalog verbs", () => {
    const names = Object.keys(FoldcaseToolkit.tools)
    expect(names).toHaveLength(3)
    expect(names).toEqual(
      expect.arrayContaining([
        "foldcase_get_showcase_schema",
        "foldcase_list_showcases",
        "foldcase_run_showcase",
      ]),
    )
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

  test("foldcase_run_showcase runs the play and reports pass/fail", async () => {
    const report = await Effect.runPromise(
      handlers.foldcase_run_showcase({ showcase_id: "sample/passes" }),
    )

    expect(report.id).toBe("sample/passes")
    expect(report.status).toBe("passed")
  })
})
