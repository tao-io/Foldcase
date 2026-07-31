import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import { generateComponentDocs, renderComponentDoc } from "./generate.js"

const Message = Schema.Union([
  Schema.TaggedStruct("Increment", {}),
  Schema.TaggedStruct("SetLabel", { label: Schema.String }),
])

class Model extends Schema.Class<Model>("Model")({
  count: Schema.Number,
  label: Schema.String,
}) {}

// The shape a real showcase file has: every Showcase of one component spreads
// the same declared schemas, so they are the same objects.
const schemas = { message: Message, model: Model } as const

const full: Showcase = { id: "counter/basic", play: () => {}, ...schemas }
const alsoFull: Showcase = { id: "counter/reset", play: () => {}, ...schemas }
const bare: Showcase = { id: "widget/opaque", play: () => {} }
const alsoBare: Showcase = { id: "gadget/opaque", play: () => {} }

describe("renderComponentDoc", () => {
  test("documents both the Message and Model schema tables under a titled section", async () => {
    const doc = await Effect.runPromise(renderComponentDoc([full]))

    expect(doc.component).toBe("counter/basic")
    expect(doc.markdown).toContain("# counter/basic")
    expect(doc.markdown).toContain("## Messages")
    expect(doc.markdown).toContain("| Message | Field | Type | Optional |")
    expect(doc.markdown).toContain("`Increment`")
    expect(doc.markdown).toContain("`SetLabel`")
    expect(doc.markdown).toContain("## Model")
    expect(doc.markdown).toContain("| Field | Type | Optional |")
    expect(doc.markdown).toContain("`count`")
  })

  test("names the component after the id namespace its Showcases share", async () => {
    const doc = await Effect.runPromise(renderComponentDoc([full, alsoFull]))

    expect(doc.component).toBe("counter")
    expect(doc.showcases).toEqual(["counter/basic", "counter/reset"])
    expect(doc.markdown).toContain("# counter")
    // The document says which Showcases it came from, so a reader can still
    // find them — the ids are no longer in the filename.
    expect(doc.markdown).toContain("`counter/basic`")
    expect(doc.markdown).toContain("`counter/reset`")
  })

  test("documents a Showcase with no schema gracefully, not as an error", async () => {
    const doc = await Effect.runPromise(renderComponentDoc([bare]))

    expect(doc.component).toBe("widget/opaque")
    expect(doc.markdown).toContain("# widget/opaque")
    expect(doc.markdown.toLowerCase()).toContain("no model or message schema")
    // A bare showcase must not emit empty table headers.
    expect(doc.markdown).not.toContain("| Message | Field |")
  })
})

describe("generateComponentDocs", () => {
  test("emits one doc per component, not one identical doc per Showcase", async () => {
    // Five Showcases of one component used to produce five files that differed
    // only in their title.
    const docs = await Effect.runPromise(generateComponentDocs([full, alsoFull]))

    expect(docs).toHaveLength(1)
    expect(docs[0]?.component).toBe("counter")
    expect(docs[0]?.showcases).toEqual(["counter/basic", "counter/reset"])
  })

  test("keeps components apart when their declared schemas differ", async () => {
    const other: Showcase = {
      id: "counter/other",
      play: () => {},
      message: Schema.Union([Schema.TaggedStruct("Cleared", {})]),
    }
    const docs = await Effect.runPromise(generateComponentDocs([full, alsoFull, other]))

    expect(docs.map((doc) => doc.component)).toEqual(["counter", "counter/other"])
  })

  test("never merges Showcases that simply declare nothing", async () => {
    // Two schemaless Showcases share the same (absent) schemas, which must not
    // be read as "the same component".
    const docs = await Effect.runPromise(generateComponentDocs([bare, alsoBare]))

    expect(docs.map((doc) => doc.component)).toEqual(["gadget/opaque", "widget/opaque"])
  })

  test("sorts components by name for deterministic output", async () => {
    const docs = await Effect.runPromise(generateComponentDocs([bare, full, alsoFull]))

    expect(docs.map((doc) => doc.component)).toEqual(["counter", "widget/opaque"])
  })
})
