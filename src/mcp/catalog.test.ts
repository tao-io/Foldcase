import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import {
  CatalogDirectoryError,
  makeCatalog,
  NoMessageSchemaError,
  NoModelSchemaError,
  NoShowcaseMatchedError,
  ShowcaseNotFoundError,
} from "./catalog.js"

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

describe("the catalog errors", () => {
  // An MCP host renders a declared tool failure as the error's `message`, and a
  // schema-backed error inherits an empty one — so a payload that is not in the
  // message never reaches the agent, however carefully it was typed.
  test("say what they carry, so the payload survives the trip to the agent", () => {
    expect(new ShowcaseNotFoundError({ id: "nope", available: ["a/one", "a/two"] }).message).toBe(
      'no Showcase with id "nope"; available: a/one, a/two',
    )
    expect(new NoShowcaseMatchedError({ prefix: "b/", available: ["a/one"] }).message).toBe(
      'no Showcase id starts with "b/"; available: a/one',
    )
    expect(new NoMessageSchemaError({ id: "a/one" }).message).toBe(
      'Showcase "a/one" declares no Message schema',
    )
    expect(new NoModelSchemaError({ id: "a/one" }).message).toBe(
      'Showcase "a/one" declares no Model schema',
    )
    expect(new CatalogDirectoryError({ dir: "/tmp/gone", reason: "ENOENT" }).message).toBe(
      "/tmp/gone: ENOENT",
    )
  })
})

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

describe("FoldcaseCatalog list gaps", () => {
  // A component with a two-tag union and a play that declares one of them: the
  // shape an agent has to be able to see, because the tag nobody dispatches is
  // the Showcase it should write next.
  const CounterMessage = Schema.Union([
    Schema.TaggedStruct("Increment", {}),
    Schema.TaggedStruct("Reset", {}),
  ])
  const increments: Showcase = {
    id: "counter/increments",
    play: () => {},
    message: CounterMessage,
    dispatches: ["Increment"],
  }

  test("says what each Showcase declares it dispatches", async () => {
    const catalog = Effect.runSync(makeCatalog([increments, passing]))
    const listing = await Effect.runPromise(catalog.list)

    expect(listing.showcases.map((entry) => entry.dispatches)).toEqual([["Increment"], undefined])
  })

  test("names the Messages of a component that no Showcase dispatches", async () => {
    const catalog = Effect.runSync(makeCatalog([increments]))
    const listing = await Effect.runPromise(catalog.list)

    expect(listing.gaps).toEqual([
      { component: "counter", undispatched: ["Reset"], unknown: [] },
    ])
  })

  test("names a declared tag the union does not carry, and reports nothing for a component nobody declared", async () => {
    const typo: Showcase = {
      id: "gauge/typo",
      play: () => {},
      message: CounterMessage,
      dispatches: ["Incremnet"],
    }
    const quiet: Showcase = { id: "widget/quiet", play: () => {}, message: CounterMessage }
    const catalog = Effect.runSync(makeCatalog([typo, quiet]))
    const listing = await Effect.runPromise(catalog.list)

    // The component nobody declared for is absent, not an empty gap: unknown
    // must never read as fully showcased.
    expect(listing.gaps?.map((gap) => gap.component)).toEqual(["gauge"])
    expect(listing.gaps?.[0]?.unknown).toEqual(["Incremnet"])
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

describe("FoldcaseCatalog runAll", () => {
  test("runs every Showcase into one suite report, failures and all", async () => {
    const catalog = Effect.runSync(makeCatalog([passing, failing]))
    const suite = await Effect.runPromise(catalog.runAll(Option.none()))

    // A failing play is data, the same as it is for the whole-suite CLI: the
    // call succeeds and the verdict is in the report.
    expect([suite.total, suite.passed, suite.failed]).toEqual([2, 1, 1])
    expect(suite.reports.map((report) => report.id)).toEqual(["sample/passes", "sample/fails"])
    expect(suite.reports[1]?.error?.message).toBe("boom")
  })

  test("runs only the Showcases under an id prefix", async () => {
    const catalog = Effect.runSync(makeCatalog([passing, failing, withSchema]))
    const suite = await Effect.runPromise(catalog.runAll(Option.some("sample/with-")))

    expect(suite.reports.map((report) => report.id)).toEqual(["sample/with-schema"])
  })

  test("fails NoShowcaseMatchedError, naming the available ids, for a prefix that matches nothing", async () => {
    const catalog = Effect.runSync(makeCatalog([passing]))
    const error = await Effect.runPromise(Effect.flip(catalog.runAll(Option.some("nope/"))))

    expect(error._tag).toBe("foldcase/NoShowcaseMatchedError")
    expect(error.prefix).toBe("nope/")
    // The ids travel with the error, so an agent can correct itself in one turn.
    expect(error.available).toEqual(["sample/passes"])
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
