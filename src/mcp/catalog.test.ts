import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import { makeCatalog, ShowcaseNotFoundError } from "./catalog.js"

// A representative Message-union schema, standing in for the typed Message
// union a real Foldkit Showcase attaches so the catalog can introspect it.
const ClickMessage = Schema.TaggedStruct("Clicked", {})

// The Model peer of it: what a play asserts on, and what an agent has to know
// the shape of before it can write an assertion.
class CounterModel extends Schema.Class<CounterModel>("CounterModel")({
  count: Schema.Number,
}) {}

const passing: Showcase = { id: "sample/passes", play: () => {} }
const withSchema: Showcase = {
  id: "sample/with-schema",
  play: () => {},
  message: ClickMessage,
  model: CounterModel,
}
const messageOnly: Showcase = {
  id: "sample/message-only",
  play: () => {},
  message: ClickMessage,
}
const failing: Showcase = {
  id: "sample/fails",
  play: () => {
    // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
    throw new Error("boom")
  },
}

describe("FoldcaseCatalog list", () => {
  test("enumerates showcases in order, flagging the schemas each one carries", async () => {
    const catalog = Effect.runSync(makeCatalog([passing, withSchema, messageOnly]))
    const listing = await Effect.runPromise(catalog.list)

    expect(listing.showcases.map((entry) => entry.id)).toEqual([
      "sample/passes",
      "sample/with-schema",
      "sample/message-only",
    ])
    expect(listing.showcases.map((entry) => entry.hasMessageSchema)).toEqual([false, true, true])
    // The two flags are read separately: a Showcase can declare either, both or
    // neither, and each says which introspection verb is worth calling.
    expect(listing.showcases.map((entry) => entry.hasModelSchema)).toEqual([false, true, false])
  })
})

describe("FoldcaseCatalog modelSchemaFor", () => {
  test("introspects a Showcase's Model schema into a JSON Schema document", async () => {
    const catalog = Effect.runSync(makeCatalog([withSchema]))
    const result = await Effect.runPromise(catalog.modelSchemaFor("sample/with-schema"))

    expect(result.id).toBe("sample/with-schema")
    // The same draft-2020-12 document shape the Message verb answers with.
    const serialized = JSON.stringify(result.jsonSchema)
    expect(serialized).toContain("CounterModel")
    expect(serialized).toContain("count")
  })

  test("fails NoModelSchemaError when the Showcase declares no Model schema", async () => {
    const catalog = Effect.runSync(makeCatalog([messageOnly]))
    const error = await Effect.runPromise(Effect.flip(catalog.modelSchemaFor("sample/message-only")))

    expect(error._tag).toBe("foldcase/NoModelSchemaError")
  })

  test("fails ShowcaseNotFoundError, naming the available ids, for an unknown id", async () => {
    const catalog = Effect.runSync(makeCatalog([withSchema]))
    const error = await Effect.runPromise(Effect.flip(catalog.modelSchemaFor("nope")))

    expect(error._tag).toBe("foldcase/ShowcaseNotFoundError")
    expect(JSON.stringify(error)).toContain("sample/with-schema")
  })
})

describe("FoldcaseCatalog schemaFor", () => {
  test("introspects a Showcase's Message schema into a JSON Schema document", async () => {
    const catalog = Effect.runSync(makeCatalog([withSchema]))
    const result = await Effect.runPromise(catalog.schemaFor("sample/with-schema"))

    expect(result.id).toBe("sample/with-schema")
    // The document is the draft-2020-12 shape from Schema.toJsonSchemaDocument.
    const serialized = JSON.stringify(result.jsonSchema)
    expect(serialized).toContain("object")
    expect(serialized).toContain("Clicked")
  })

  test("fails ShowcaseNotFoundError, naming the available ids, for an unknown id", async () => {
    const catalog = Effect.runSync(makeCatalog([passing, withSchema]))
    const error = await Effect.runPromise(Effect.flip(catalog.schemaFor("nope")))

    expect(error._tag).toBe("foldcase/ShowcaseNotFoundError")
    expect(error).toBeInstanceOf(ShowcaseNotFoundError)
    // The available ids travel with the error so an agent can self-correct.
    expect(JSON.stringify(error)).toContain("sample/with-schema")
  })

  test("fails NoMessageSchemaError when the Showcase declares no Message schema", async () => {
    const catalog = Effect.runSync(makeCatalog([passing]))
    const error = await Effect.runPromise(Effect.flip(catalog.schemaFor("sample/passes")))

    expect(error._tag).toBe("foldcase/NoMessageSchemaError")
  })
})

describe("FoldcaseCatalog runById", () => {
  test("runs a Showcase's play and reports a pass", async () => {
    const catalog = Effect.runSync(makeCatalog([passing]))
    const report = await Effect.runPromise(catalog.runById("sample/passes"))

    expect(report.id).toBe("sample/passes")
    expect(report.status).toBe("passed")
  })

  test("runs a failing play and reports a fail carrying the serialized error", async () => {
    const catalog = Effect.runSync(makeCatalog([failing]))
    const report = await Effect.runPromise(catalog.runById("sample/fails"))

    expect(report.status).toBe("failed")
    expect(report.error?.message).toBe("boom")
  })

  test("fails ShowcaseNotFoundError for an unknown id", async () => {
    const catalog = Effect.runSync(makeCatalog([passing]))
    const error = await Effect.runPromise(Effect.flip(catalog.runById("nope")))

    expect(error._tag).toBe("foldcase/ShowcaseNotFoundError")
  })
})
