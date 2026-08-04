import { describe, expect, test } from "bun:test"
import * as Option from "effect/Option"

import type { CatalogLoad, LoadedShowcase } from "../cli.js"
import type { Showcase } from "../runner.js"
import { initialModel, MountedShowcase, SelectedShowcase, selectedEntry, update } from "./app.js"
import { labCatalogOf } from "./catalog.js"

/** A Showcase with nothing to draw: the pre-`mount` shape, still valid. */
const plain = (id: string): Showcase => ({ id, play: () => {} })

const loadOf = (entries: ReadonlyArray<LoadedShowcase>): CatalogLoad => ({
  loaded: entries,
  showcases: entries.map((entry) => entry.showcase),
  failures: [],
})

const catalogOf = (...ids: ReadonlyArray<string>) =>
  labCatalogOf(loadOf(ids.map((id) => ({ showcase: plain(id) }))))

describe("initialModel", () => {
  test("opens on the first Showcase in id order, so a lab with a catalog is never blank", () => {
    const model = initialModel(catalogOf("button/two", "alpha/one", "button/one"))

    expect(model.maybeSelectedId).toEqual(Option.some("alpha/one"))
  })

  test("opens on nothing when the catalog is empty, rather than on an id that is not there", () => {
    const model = initialModel(catalogOf())

    expect(model.maybeSelectedId).toEqual(Option.none())
    expect(model.catalog.total).toBe(0)
  })
})

describe("update", () => {
  test("moves the selection to the Showcase that was chosen", () => {
    const [model] = update(
      initialModel(catalogOf("button/one", "button/two")),
      SelectedShowcase({ id: "button/two" }),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("button/two"))
  })

  test("leaves the selection alone when the id is one the catalog never declared", () => {
    const before = initialModel(catalogOf("button/one", "button/two"))
    const [model] = update(before, SelectedShowcase({ id: "button/three" }))

    expect(model.maybeSelectedId).toEqual(Option.some("button/one"))
  })

  test("records that the canvas drew without moving anything, because a mount is not a navigation", () => {
    const before = initialModel(catalogOf("button/one", "button/two"))
    const [model, commands] = update(before, MountedShowcase({ id: "button/one" }))

    expect(model).toBe(before)
    expect(commands).toEqual([])
  })
})

describe("selectedEntry", () => {
  test("reads back the entry the selection names, so the details panel needs no second lookup", () => {
    const catalog = labCatalogOf(
      loadOf([
        { file: "/app/button.showcase.ts", showcase: plain("button/one") },
        {
          file: "/app/button.showcase.ts",
          showcase: { id: "button/two", play: () => {}, mount: () => () => {} },
        },
      ]),
    )
    const [model] = update(initialModel(catalog), SelectedShowcase({ id: "button/two" }))

    expect(Option.map(selectedEntry(model), (entry) => [entry.id, entry.hasMount])).toEqual(
      Option.some(["button/two", true]),
    )
  })

  test("reads back nothing when nothing is selected, so an empty catalog draws no panel", () => {
    expect(selectedEntry(initialModel(catalogOf()))).toEqual(Option.none())
  })
})
