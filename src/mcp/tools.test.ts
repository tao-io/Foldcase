import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner"
import { makeCatalog } from "./catalog"
import { FoldcaseToolkit, makeHandlers } from "./tools"

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
})

describe("foldcase mcp handlers", () => {
  const handlers = makeHandlers(makeCatalog([passing, withSchema]))

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
