import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import { componentGaps, generateComponentDocs, renderComponentDoc } from "./generate.js"

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

// The shape a real Foldkit app has: one Model struct and one Message union for
// the whole app, every component a slice of them, so Showcases of *different*
// components hand `docs` the very same two Schema objects.
const otherComponent: Showcase = { id: "gauge/at-zero", play: () => {}, ...schemas }

// Every case but the schemaless one expects a document; unwrapping here keeps
// the assertions about the document, not about the Option.
const docOf = (group: ReadonlyArray<Showcase>) =>
  Effect.runPromise(renderComponentDoc(group).pipe(Effect.map(Option.getOrThrow)))

describe("renderComponentDoc", () => {
  test("documents both the Message and Model schema tables under a titled section", async () => {
    const doc = await docOf([full])

    expect(doc.component).toBe("counter")
    expect(doc.markdown).toContain("# counter")
    expect(doc.markdown).toContain("## Messages")
    expect(doc.markdown).toContain("| Message | Field | Type | Optional |")
    expect(doc.markdown).toContain("`Increment`")
    expect(doc.markdown).toContain("`SetLabel`")
    expect(doc.markdown).toContain("## Model")
    expect(doc.markdown).toContain("| Field | Type | Optional |")
    expect(doc.markdown).toContain("`count`")
  })

  test("names the component after the id namespace, however deep it nests", async () => {
    const initial: Showcase = { id: "ui/picker/initial", play: () => {}, ...schemas }
    const filtering: Showcase = { id: "ui/picker/filtering", play: () => {}, ...schemas }
    const doc = await docOf([initial, filtering])

    expect(doc.component).toBe("ui/picker")
    expect(doc.markdown).toContain("# ui/picker")
  })

  test("names a component after the whole id when the id has no namespace", async () => {
    const lone: Showcase = { id: "banner", play: () => {}, ...schemas }
    const doc = await docOf([lone])

    expect(doc.component).toBe("banner")
    expect(doc.markdown).toContain("# banner")
  })

  test("lists the Showcases it was derived from, in id order", async () => {
    const doc = await docOf([alsoFull, full])

    expect(doc.component).toBe("counter")
    expect(doc.showcases).toEqual(["counter/basic", "counter/reset"])
    expect(doc.markdown).toContain("# counter")
    // The document says which Showcases it came from, so a reader can still
    // find them — the ids are no longer in the filename.
    expect(doc.markdown).toContain("`counter/basic`")
    expect(doc.markdown).toContain("`counter/reset`")
  })

  test("reads its tables from the first Showcase that declares one, in id order", async () => {
    // A namespace need not declare uniformly: `counter/increment` may be a
    // plain logic Showcase while `counter/schema` carries the schemas. The
    // lowest id declaring a Model wins, and the lowest declaring a Message
    // wins, so a component is documented from the earliest source of each.
    const quiet: Showcase = { id: "counter/aa-quiet", play: () => {} }
    const loud: Showcase = {
      id: "counter/bb-loud",
      play: () => {},
      message: Schema.Union([Schema.TaggedStruct("Cleared", {})]),
    }
    const later: Showcase = {
      id: "counter/cc-later",
      play: () => {},
      message: Schema.Union([Schema.TaggedStruct("Ignored", {})]),
      model: Model,
    }
    const doc = await docOf([later, quiet, loud])

    expect(doc.component).toBe("counter")
    expect(doc.markdown).toContain("`Cleared`")
    expect(doc.markdown).not.toContain("`Ignored`")
    // Nothing earlier declares a Model, so the later one still supplies it.
    expect(doc.markdown).toContain("## Model")
    expect(doc.markdown).toContain("`count`")
  })

  test("names the Messages no play dispatches, under the table that lists them", async () => {
    const increments: Showcase = {
      id: "counter/increments",
      play: () => {},
      dispatches: ["Increment"],
      ...schemas,
    }
    const doc = await docOf([increments])

    expect(doc.markdown).toContain("Not showcased: `SetLabel`")
    // The line sits under the Messages table, and above the Model section.
    expect(doc.markdown.indexOf("Not showcased")).toBeGreaterThan(doc.markdown.indexOf("| Message"))
    expect(doc.markdown.indexOf("Not showcased")).toBeLessThan(doc.markdown.indexOf("## Model"))
    // The document carries the gap as data too, so the CLI reads it rather
    // than its own Markdown.
    expect(doc.gap?.undispatched).toEqual(["SetLabel"])
  })

  test("says nothing about gaps when every Message of the union is showcased", async () => {
    const whole: Showcase = {
      id: "counter/whole",
      play: () => {},
      dispatches: ["Increment", "SetLabel"],
      ...schemas,
    }
    const doc = await docOf([whole])

    expect(doc.markdown).not.toContain("Not showcased")
    expect(doc.markdown).not.toContain("Unknown dispatches")
    expect(doc.gap?.undispatched).toEqual([])
  })

  test("says nothing about gaps when no Showcase declares what it dispatches", async () => {
    const doc = await docOf([full])

    expect(doc.markdown).not.toContain("Not showcased")
    expect(doc.gap).toBeUndefined()
  })

  test("calls a declared tag the union does not carry out, where the gaps are shown", async () => {
    const typo: Showcase = {
      id: "counter/typo",
      play: () => {},
      dispatches: ["Increment", "SetLable"],
      ...schemas,
    }
    const doc = await docOf([typo])

    expect(doc.markdown).toContain("Unknown dispatches: `SetLable`")
    expect(doc.gap?.unknown).toEqual(["SetLable"])
  })

  test("declines to document a component that declares nothing, and does not fail", async () => {
    // An opaque Showcase has nothing to table, so it gets no document — a page
    // saying only "no schema declared" is worse than no page. `none`, not a
    // failure: a Showcase that says nothing is data, like a failing one.
    const doc = await Effect.runPromise(renderComponentDoc([bare]))

    expect(Option.isNone(doc)).toBe(true)
  })
})

describe("componentGaps", () => {
  test("names the Message tags no Showcase of the component declares it dispatches", async () => {
    const increments: Showcase = {
      id: "counter/increments",
      play: () => {},
      dispatches: ["Increment"],
      ...schemas,
    }
    const gaps = await Effect.runPromise(componentGaps([increments]))

    expect(gaps.map((gap) => gap.component)).toEqual(["counter"])
    expect(gaps[0]?.undispatched).toEqual(["SetLabel"])
    expect(gaps[0]?.unknown).toEqual([])
  })

  test("reads the declarations of every Showcase in the component, not just the first", async () => {
    const increments: Showcase = {
      id: "counter/increments",
      play: () => {},
      dispatches: ["Increment"],
      ...schemas,
    }
    const labels: Showcase = {
      id: "counter/labels",
      play: () => {},
      dispatches: ["SetLabel"],
      ...schemas,
    }
    const gaps = await Effect.runPromise(componentGaps([increments, labels]))

    // Both tags are dispatched somewhere in the component, so nothing is
    // missing — and the component is still reported, because "covered" and
    // "nobody said" must not read the same.
    expect(gaps.map((gap) => gap.component)).toEqual(["counter"])
    expect(gaps[0]?.undispatched).toEqual([])
    expect(gaps[0]?.unknown).toEqual([])
  })

  test("reports nothing for a component where no Showcase declares dispatches", async () => {
    // Nobody declared, so nothing is known. Reporting an empty gap here would
    // read as "every Message is showcased", which is the one wrong answer.
    const gaps = await Effect.runPromise(componentGaps([full, alsoFull]))

    expect(gaps).toEqual([])
  })

  test("names a declared tag the union does not carry, so a typo cannot lie quietly", async () => {
    const typo: Showcase = {
      id: "counter/typo",
      play: () => {},
      dispatches: ["Increment", "SetLable"],
      ...schemas,
    }
    const gaps = await Effect.runPromise(componentGaps([typo]))

    expect(gaps[0]?.unknown).toEqual(["SetLable"])
    // And the tag it was meant to be is still missing from the showcased set.
    expect(gaps[0]?.undispatched).toEqual(["SetLabel"])
  })

  test("takes an empty declaration as a declaration — a play that dispatches nothing", async () => {
    const inert: Showcase = { id: "counter/inert", play: () => {}, dispatches: [], ...schemas }
    const gaps = await Effect.runPromise(componentGaps([inert]))

    expect(gaps[0]?.undispatched).toEqual(["Increment", "SetLabel"])
  })

  test("reports nothing for a component that declares no Message union to compare against", async () => {
    const opaque: Showcase = { id: "widget/opaque", play: () => {}, dispatches: ["Clicked"] }
    const gaps = await Effect.runPromise(componentGaps([opaque]))

    expect(gaps).toEqual([])
  })

  test("reports one entry per component, sorted by name", async () => {
    const zeta: Showcase = { id: "zeta/one", play: () => {}, dispatches: ["Increment"], ...schemas }
    const alpha: Showcase = {
      id: "alpha/one",
      play: () => {},
      dispatches: ["Increment", "SetLabel"],
      ...schemas,
    }
    const gaps = await Effect.runPromise(componentGaps([zeta, bare, alpha]))

    expect(gaps.map((gap) => gap.component)).toEqual(["alpha", "zeta"])
    expect(gaps[1]?.undispatched).toEqual(["SetLabel"])
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

  test("keeps components apart when a whole app shares one Model and one Message", async () => {
    // The Foldkit shape: `counter/*` and `gauge/*` declare the identical Schema
    // objects, and used to collapse into a single document titled after
    // whichever Showcase came first.
    const docs = await Effect.runPromise(
      generateComponentDocs([full, alsoFull, otherComponent]),
    )

    expect(docs.map((doc) => doc.component)).toEqual(["counter", "gauge"])
    expect(docs[1]?.showcases).toEqual(["gauge/at-zero"])
  })

  test("keeps one namespace one component, whatever its Showcases declare", async () => {
    // A namespace is the component. A Showcase declaring a different Message
    // does not split `counter` in two — the app is free to re-declare, and a
    // reader looking for `counter` must find one document.
    const other: Showcase = {
      id: "counter/other",
      play: () => {},
      message: Schema.Union([Schema.TaggedStruct("Cleared", {})]),
    }
    const docs = await Effect.runPromise(generateComponentDocs([full, alsoFull, other]))

    expect(docs.map((doc) => doc.component)).toEqual(["counter"])
    expect(docs[0]?.showcases).toEqual(["counter/basic", "counter/other", "counter/reset"])
  })

  test("writes nothing for a namespace whose Showcases declare nothing", async () => {
    const docs = await Effect.runPromise(generateComponentDocs([bare, alsoBare]))

    expect(docs).toEqual([])
  })

  test("sorts components by name for deterministic output", async () => {
    const first: Showcase = { id: "alpha/one", play: () => {}, ...schemas }
    const last: Showcase = { id: "zeta/one", play: () => {}, ...schemas }
    const docs = await Effect.runPromise(generateComponentDocs([last, bare, full, first]))

    expect(docs.map((doc) => doc.component)).toEqual(["alpha", "counter", "zeta"])
  })
})
