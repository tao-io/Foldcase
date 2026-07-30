import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import { generateShowcaseDocs, renderShowcaseDoc } from "./generate.js"

const Message = Schema.Union([
  Schema.TaggedStruct("Increment", {}),
  Schema.TaggedStruct("SetLabel", { label: Schema.String }),
])

class Model extends Schema.Class<Model>("Model")({
  count: Schema.Number,
  label: Schema.String,
}) {}

const full: Showcase = { id: "counter/basic", play: () => {}, message: Message, model: Model }
const bare: Showcase = { id: "widget/opaque", play: () => {} }

describe("renderShowcaseDoc", () => {
  test("documents both the Message and Model schema tables under a titled section", async () => {
    const doc = await Effect.runPromise(renderShowcaseDoc(full))

    expect(doc.id).toBe("counter/basic")
    expect(doc.markdown).toContain("# counter/basic")
    expect(doc.markdown).toContain("## Messages")
    expect(doc.markdown).toContain("| Message | Field | Type | Optional |")
    expect(doc.markdown).toContain("`Increment`")
    expect(doc.markdown).toContain("`SetLabel`")
    expect(doc.markdown).toContain("## Model")
    expect(doc.markdown).toContain("| Field | Type | Optional |")
    expect(doc.markdown).toContain("`count`")
  })

  test("documents a Showcase with no schema gracefully, not as an error", async () => {
    const doc = await Effect.runPromise(renderShowcaseDoc(bare))

    expect(doc.id).toBe("widget/opaque")
    expect(doc.markdown).toContain("# widget/opaque")
    expect(doc.markdown.toLowerCase()).toContain("no model or message schema")
    // A bare showcase must not emit empty table headers.
    expect(doc.markdown).not.toContain("| Message | Field |")
  })
})

describe("generateShowcaseDocs", () => {
  test("emits one doc per Showcase, sorted by id for deterministic output", async () => {
    const docs = await Effect.runPromise(generateShowcaseDocs([full, bare]))

    expect(docs.map((doc) => doc.id)).toEqual(["counter/basic", "widget/opaque"])
  })
})
