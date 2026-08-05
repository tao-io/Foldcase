import { describe, expect, test } from "bun:test"
import * as Schema from "effect/Schema"

import type { CatalogLoad, LoadedShowcase } from "../cli.js"
import { ShowcaseModuleError } from "../cli.js"
import type { Showcase } from "../runner.js"
import { LabCatalog, labCatalogOf } from "./catalog.js"

/** A Showcase with nothing to draw: the pre-`mount` shape, still valid. */
const plain = (id: string): Showcase => ({ id, play: () => {} })

// The Message union and the Model a real Foldkit Showcase declares, standing in
// here for the panels the lab opens beside the canvas.
const ClickMessage = Schema.TaggedStruct("Clicked", {})
class CounterModel extends Schema.Class<CounterModel>("CounterModel")({
  count: Schema.Number,
}) {}

/**
 * A load, as the one loader hands it over. Built in memory rather than read
 * from disk: the projection is pure, so nothing here needs a file to exist.
 */
const loadOf = (
  entries: ReadonlyArray<LoadedShowcase>,
  failures: ReadonlyArray<ShowcaseModuleError> = [],
): CatalogLoad => ({
  loaded: entries,
  showcases: entries.map((entry) => entry.showcase),
  failures,
})

describe("labCatalogOf", () => {
  test("groups entries by id namespace, so a component is what the docs and the mcp prefix already mean", () => {
    const catalog = labCatalogOf(
      loadOf([
        { showcase: plain("button/starts-unclicked") },
        { showcase: plain("ui/picker/initial") },
        { showcase: plain("solo") },
        { showcase: plain("button/counts-one-click") },
      ]),
    )

    expect(catalog.components.map((component) => component.component)).toEqual([
      "button",
      "solo",
      "ui/picker",
    ])
    expect(catalog.components.map((component) => component.entries.map((entry) => entry.id))).toEqual(
      [["button/counts-one-click", "button/starts-unclicked"], ["solo"], ["ui/picker/initial"]],
    )
  })

  test("flags what each Showcase declares, so the lab draws what it can and says so when it cannot", () => {
    const catalog = labCatalogOf(
      loadOf([
        { file: "/app/button.showcase.ts", showcase: plain("button/silent") },
        {
          file: "/app/button.showcase.ts",
          showcase: {
            id: "button/drawn",
            play: () => {},
            mount: () => () => {},
            message: ClickMessage,
            model: CounterModel,
          },
        },
      ]),
    )
    const [drawn, silent] = catalog.components[0]?.entries ?? []

    expect(drawn?.hasMount).toBe(true)
    // A Showcase without `mount` is listed like any other and gets no canvas —
    // the record's answer, not a defect (ADR-0001 › Amendment 6).
    expect(silent?.hasMount).toBe(false)
    expect([drawn?.hasMessageSchema, drawn?.hasModelSchema]).toEqual([true, true])
    expect([silent?.hasMessageSchema, silent?.hasModelSchema]).toEqual([false, false])
    expect(drawn?.file).toBe("/app/button.showcase.ts")
  })

  test("leaves the file out for a catalog no file backs, rather than inventing one", () => {
    const catalog = labCatalogOf(loadOf([{ showcase: plain("solo") }]))

    expect(catalog.components[0]?.entries[0]?.file).toBeUndefined()
  })

  test("counts every entry, not every component, so the total is what the loader read", () => {
    const catalog = labCatalogOf(
      loadOf([
        { showcase: plain("button/one") },
        { showcase: plain("button/two") },
        { showcase: plain("solo") },
      ]),
    )

    expect(catalog.total).toBe(3)
    expect(catalog.components).toHaveLength(2)
  })

  test("shows the file that would not load, rather than losing the ones that did", () => {
    const broken = new ShowcaseModuleError({
      path: "/app/broken.showcase.ts",
      reason: "Cannot find module 'foldkit/html'",
    })
    const catalog = labCatalogOf(loadOf([{ showcase: plain("button/one") }], [broken]))

    expect(catalog.components.map((component) => component.component)).toEqual(["button"])
    expect(catalog.failures.map((failure) => failure.path)).toEqual(["/app/broken.showcase.ts"])
    // A file that will not load never declared an id, so it counts for nothing
    // in the total — it is data beside the gallery, not an entry in it.
    expect(catalog.total).toBe(1)
  })

  test("survives an encode/decode round-trip, because an agent decodes the document", () => {
    const catalog = labCatalogOf(
      loadOf(
        [
          { file: "/app/button.showcase.ts", showcase: plain("button/silent") },
          {
            file: "/app/button.showcase.ts",
            showcase: {
              id: "button/drawn",
              play: () => {},
              mount: () => () => {},
              message: ClickMessage,
              model: CounterModel,
            },
          },
          { showcase: plain("solo") },
        ],
        [new ShowcaseModuleError({ path: "/app/broken.showcase.ts", reason: "bad import" })],
      ),
    )

    const wire = Schema.encodeUnknownSync(LabCatalog)(catalog)
    const decoded = Schema.decodeUnknownSync(LabCatalog)(JSON.parse(JSON.stringify(wire)))

    expect(decoded.total).toBe(3)
    expect(decoded.components.map((component) => component.component)).toEqual(["button", "solo"])
    expect(decoded.components[0]?.entries.map((entry) => entry.hasMount)).toEqual([true, false])
    expect(decoded.components[0]?.entries[0]?.file).toBe("/app/button.showcase.ts")
    expect(decoded.failures[0]?.reason).toBe("bad import")
  })
})
