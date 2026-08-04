import { describe, expect, test } from "bun:test"
import * as Option from "effect/Option"
import { fromString } from "foldkit/url"

import type { CatalogLoad, LoadedShowcase } from "../cli.js"
import type { Showcase } from "../runner.js"
import {
  ChangedAddress,
  initialModel,
  MountedShowcase,
  SelectedShowcase,
  selectedEntry,
  update,
} from "./app.js"
import { labCatalogOf } from "./catalog.js"

/** The `Url` the routing `init` is handed for a browser sitting at this address. */
const urlOf = (address: string) => Option.getOrThrow(fromString(address))

/** The address a lab is opened at when nobody named a showcase. */
const bare = urlOf("http://localhost:5198/")

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
    const model = initialModel(catalogOf("button/two", "alpha/one", "button/one"), bare)

    expect(model.maybeSelectedId).toEqual(Option.some("alpha/one"))
  })

  test("opens on nothing when the catalog is empty, rather than on an id that is not there", () => {
    const model = initialModel(catalogOf(), bare)

    expect(model.maybeSelectedId).toEqual(Option.none())
    expect(model.catalog.total).toBe(0)
  })

  test("opens on the Showcase the address names, which is what makes a reload restore it", () => {
    const model = initialModel(
      catalogOf("alpha/one", "button/one", "button/two"),
      urlOf("http://localhost:5198/?showcase=button%2Ftwo"),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("button/two"))
    expect(model.maybeUnknownId).toEqual(Option.none())
  })

  test("falls back to the default and keeps the id it could not find, so a wrong address is not a blank canvas", () => {
    const model = initialModel(
      catalogOf("alpha/one", "button/one"),
      urlOf("http://localhost:5198/?showcase=does%2Fnot%2Fexist"),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("alpha/one"))
    expect(model.maybeUnknownId).toEqual(Option.some("does/not/exist"))
  })
})

describe("update", () => {
  test("moves the selection to the Showcase that was chosen", () => {
    const [model] = update(
      initialModel(catalogOf("button/one", "button/two"), bare),
      SelectedShowcase({ id: "button/two" }),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("button/two"))
  })

  test("writes the address of the Showcase that was chosen, so the bar holds what the canvas draws", () => {
    const [, commands] = update(
      initialModel(catalogOf("button/one", "button/two"), bare),
      SelectedShowcase({ id: "button/two" }),
    )

    expect(commands.map((command) => [command.name, command.args])).toEqual([
      ["WriteAddress", { address: "/?showcase=button%2Ftwo" }],
    ])
  })

  test("leaves the selection alone when the id is one the catalog never declared", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [model] = update(before, SelectedShowcase({ id: "button/three" }))

    expect(model.maybeSelectedId).toEqual(Option.some("button/one"))
    expect(model.maybeUnknownId).toEqual(Option.some("button/three"))
  })

  test("writes no address for an id the catalog never declared, so a bad dispatch cannot be linked to", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [, commands] = update(before, SelectedShowcase({ id: "button/three" }))

    expect(commands).toEqual([])
  })

  test("moves the selection to the id a new address names, which is what makes back and forward work", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [model, commands] = update(
      before,
      ChangedAddress({ url: urlOf("http://localhost:5198/?showcase=button%2Ftwo") }),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("button/two"))
    // The address is already written — reading it back must not write it again,
    // or the lab pushes a step of history for every step of history.
    expect(commands).toEqual([])
  })

  test("keeps the selection when a new address names nothing, so a stray link cannot empty the gallery", () => {
    const before = initialModel(
      catalogOf("button/one", "button/two"),
      urlOf("http://localhost:5198/?showcase=button%2Ftwo"),
    )
    const [model] = update(before, ChangedAddress({ url: urlOf("http://localhost:5198/other") }))

    expect(model.maybeSelectedId).toEqual(Option.some("button/two"))
    expect(model.maybeUnknownId).toEqual(Option.none())
  })

  test("names the id a new address could not find, and stays where it was", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [model] = update(
      before,
      ChangedAddress({ url: urlOf("http://localhost:5198/?showcase=does%2Fnot%2Fexist") }),
    )

    expect(model.maybeSelectedId).toEqual(Option.some("button/one"))
    expect(model.maybeUnknownId).toEqual(Option.some("does/not/exist"))
  })

  test("records the address it moved to, so the next move is written against the page it is on", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [moved] = update(
      before,
      ChangedAddress({ url: urlOf("http://localhost:5198/lab/?theme=dark") }),
    )
    const [, commands] = update(moved, SelectedShowcase({ id: "button/two" }))

    expect(commands.map((command) => command.args)).toEqual([
      { address: "/lab/?theme=dark&showcase=button%2Ftwo" },
    ])
  })

  test("records that the canvas drew without moving anything, because a mount is not a navigation", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
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
    const [model] = update(initialModel(catalog, bare), SelectedShowcase({ id: "button/two" }))

    expect(Option.map(selectedEntry(model), (entry) => [entry.id, entry.hasMount])).toEqual(
      Option.some(["button/two", true]),
    )
  })

  test("reads back nothing when nothing is selected, so an empty catalog draws no panel", () => {
    expect(selectedEntry(initialModel(catalogOf(), bare))).toEqual(Option.none())
  })
})
