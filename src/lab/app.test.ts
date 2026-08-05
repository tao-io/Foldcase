import { describe, expect, test } from "bun:test"
import * as Option from "effect/Option"
import { fromString } from "foldkit/url"

import { type CatalogLoad, type LoadedShowcase, ShowcaseModuleError } from "../cli.js"
import type { Showcase } from "../runner.js"
import {
  ChangedAddress,
  drawableLabel,
  isFileExpanded,
  sidebarFiles,
  ToggledFile,
  drawableTotal,
  initialModel,
  isComponentExpanded,
  isSelected,
  matchingTotal,
  type Model,
  MountedShowcase,
  MovedSelection,
  neighbourId,
  SelectedShowcase,
  selectedEntry,
  sidebarComponents,
  ToggledComponent,
  TypedQuery,
  update,
} from "./app.js"
import { labCatalogOf } from "./catalog.js"

/** The `Url` the routing `init` is handed for a browser sitting at this address. */
const urlOf = (address: string) => Option.getOrThrow(fromString(address))

/** The address a lab is opened at when nobody named a showcase. */
const bare = urlOf("http://localhost:5198/")

/** A Showcase with nothing to draw: the pre-`mount` shape, still valid. */
const plain = (id: string): Showcase => ({ id, play: () => {} })

/** A Showcase the lab can put on the canvas, because it declares the seam. */
const drawable = (id: string): Showcase => ({ ...plain(id), mount: () => () => {} })

const loadOf = (
  entries: ReadonlyArray<LoadedShowcase>,
  failures: CatalogLoad["failures"] = [],
): CatalogLoad => ({
  loaded: entries,
  showcases: entries.map((entry) => entry.showcase),
  failures,
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

describe("isSelected", () => {
  test("says which row the sidebar draws as chosen, so the view asks once and cannot disagree", () => {
    const model = initialModel(catalogOf("button/one", "button/two"), bare)

    expect(isSelected(model, "button/one")).toBe(true)
    expect(isSelected(model, "button/two")).toBe(false)
  })

  test("says no row is chosen when the catalog is empty", () => {
    expect(isSelected(initialModel(catalogOf(), bare), "button/one")).toBe(false)
  })
})

describe("folding a component", () => {
  test("opens with every component unfolded, so a fresh lab shows the whole catalog", () => {
    const model = initialModel(catalogOf("alpha/one", "button/one"), bare)

    expect(model.collapsedComponents).toEqual([])
    expect(isComponentExpanded(model, "button")).toBe(true)
  })

  test("folds the component that was toggled, and unfolds it when it is toggled again", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded] = update(before, ToggledComponent({ component: "button" }))
    const [unfolded] = update(folded, ToggledComponent({ component: "button" }))

    expect(isComponentExpanded(folded, "button")).toBe(false)
    expect(isComponentExpanded(folded, "alpha")).toBe(true)
    expect(isComponentExpanded(unfolded, "button")).toBe(true)
  })

  test("folds nothing but the component named, however many are folded already", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one", "card/one"), bare)
    const [one] = update(before, ToggledComponent({ component: "button" }))
    const [two] = update(one, ToggledComponent({ component: "card" }))

    expect(two.collapsedComponents).toEqual(["button", "card"])
  })

  test("folds the component holding the selection, so the click the reader made is the one they see", () => {
    const before = initialModel(
      catalogOf("alpha/one", "button/one"),
      urlOf("http://localhost:5198/?showcase=button%2Fone"),
    )
    const [folded] = update(before, ToggledComponent({ component: "button" }))

    expect(folded.collapsedComponents).toEqual(["button"])
    expect(isComponentExpanded(folded, "button")).toBe(false)
  })

  test("unfolds the component a chosen Showcase belongs to, so a selection is never hidden", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded] = update(before, ToggledComponent({ component: "button" }))
    const [chosen] = update(folded, SelectedShowcase({ id: "button/one" }))

    expect(chosen.collapsedComponents).toEqual([])
    expect(isComponentExpanded(chosen, "button")).toBe(true)
  })

  test("unfolds the component a new address names, so back and forward never land out of sight", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded] = update(before, ToggledComponent({ component: "button" }))
    const [arrived] = update(
      folded,
      ChangedAddress({ url: urlOf("http://localhost:5198/?showcase=button%2Fone") }),
    )

    expect(isComponentExpanded(arrived, "button")).toBe(true)
  })

  test("leaves a fold alone when the address names an id the catalog never declared", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded] = update(before, ToggledComponent({ component: "button" }))
    const [arrived] = update(
      folded,
      ChangedAddress({ url: urlOf("http://localhost:5198/?showcase=button%2Fnope") }),
    )

    expect(arrived.collapsedComponents).toEqual(["button"])
  })

  test("moves nothing and writes no address, because folding is not a navigation", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded, commands] = update(before, ToggledComponent({ component: "button" }))

    expect(folded.maybeSelectedId).toEqual(before.maybeSelectedId)
    expect(commands).toEqual([])
  })
})

describe("filtering the catalog", () => {
  const wide = () =>
    initialModel(
      catalogOf("alpha/opens-clean", "button/counts-one-click", "button/starts-unclicked"),
      bare,
    )

  const drawn = (model: Model) =>
    sidebarComponents(model).map((component) => [
      component.component,
      component.entries.map((entry) => entry.id),
    ])

  test("opens on no filter, so a fresh lab shows the whole catalog", () => {
    expect(wide().query).toBe("")
    expect(drawn(wide())).toEqual([
      ["alpha", ["alpha/opens-clean"]],
      ["button", ["button/counts-one-click", "button/starts-unclicked"]],
    ])
  })

  test("records what the reader typed, and writes no address, because a filter is not a navigation", () => {
    const [model, commands] = update(wide(), TypedQuery({ query: "counts" }))

    expect(model.query).toBe("counts")
    expect(commands).toEqual([])
  })

  test("keeps only the entries whose id holds what was typed, and drops the components left empty", () => {
    const [model] = update(wide(), TypedQuery({ query: "counts" }))

    expect(drawn(model)).toEqual([["button", ["button/counts-one-click"]]])
  })

  test("matches whatever the reader's shift key did, because nobody types a catalog id exactly", () => {
    const [model] = update(wide(), TypedQuery({ query: "  BUTTON/Starts  " }))

    expect(drawn(model)).toEqual([["button", ["button/starts-unclicked"]]])
  })

  test("counts what a filter left, so the sidebar can say how much of the catalog it is showing", () => {
    const [model] = update(wide(), TypedQuery({ query: "button/" }))

    expect(matchingTotal(model)).toBe(2)
    expect(matchingTotal(wide())).toBe(3)
  })

  test("keeps the entries a fold hides, so the heading can say how many it is hiding", () => {
    const [folded] = update(wide(), ToggledComponent({ component: "button" }))

    expect(drawn(folded)).toEqual([
      ["alpha", ["alpha/opens-clean"]],
      ["button", ["button/counts-one-click", "button/starts-unclicked"]],
    ])
  })

  test("shows a match inside a folded component, because a filter that hides its own hits is a lie", () => {
    const [folded] = update(wide(), ToggledComponent({ component: "button" }))
    const [filtered] = update(folded, TypedQuery({ query: "counts" }))

    expect(isComponentExpanded(filtered, "button")).toBe(true)
    expect(drawn(filtered)).toEqual([["button", ["button/counts-one-click"]]])
  })

  test("draws nothing at all when what was typed matches no id, so the sidebar can say so", () => {
    const [model] = update(wide(), TypedQuery({ query: "nothing-is-called-this" }))

    expect(drawn(model)).toEqual([])
    expect(matchingTotal(model)).toBe(0)
  })
})

describe("the sidebar groups by file, then by component", () => {
  const at = (file: string, id: string): LoadedShowcase => ({ file, showcase: plain(id) })

  const twoFiles = () =>
    initialModel(
      labCatalogOf(
        loadOf([
          at("/app/src/button.catalog.ts", "button/starts-unclicked"),
          at("/app/src/button.catalog.ts", "button/counts-one-click"),
          at("/app/src/calendar.catalog.ts", "calendar/opens-on-today"),
        ]),
      ),
      bare,
    )

  const drawnTree = (model: Model) =>
    sidebarFiles(model).map((file) => [
      file.path,
      file.components.map((component) => [
        component.component,
        component.entries.map((entry) => entry.id),
      ]),
    ])

  test("puts every component under the file that declared it, in path order", () => {
    expect(drawnTree(twoFiles())).toEqual([
      ["/app/src/button.catalog.ts", [["button", ["button/counts-one-click", "button/starts-unclicked"]]]],
      ["/app/src/calendar.catalog.ts", [["calendar", ["calendar/opens-on-today"]]]],
    ])
  })

  test("keeps a file holding two components as one file with two groups under it", () => {
    const model = initialModel(
      labCatalogOf(
        loadOf([at("/app/src/ui.catalog.ts", "alpha/one"), at("/app/src/ui.catalog.ts", "beta/one")]),
      ),
      bare,
    )

    expect(drawnTree(model)).toEqual([
      ["/app/src/ui.catalog.ts", [["alpha", ["alpha/one"]], ["beta", ["beta/one"]]]],
    ])
  })

  test("carries a file the loader could not read, so the tree is where the reader meets it", () => {
    const model = initialModel(
      labCatalogOf(
        loadOf([at("/app/src/button.catalog.ts", "button/starts-unclicked")], [
          new ShowcaseModuleError({ path: "/app/src/broken.catalog.ts", reason: "Cannot find module" }),
        ]),
      ),
      bare,
    )
    const files = sidebarFiles(model)

    expect(files.map((file) => [file.path, file.components.length, file.maybeFailure !== undefined])).toEqual(
      [
        ["/app/src/broken.catalog.ts", 0, true],
        ["/app/src/button.catalog.ts", 1, false],
      ],
    )
  })

  test("drops a file the filter emptied, and keeps one whose own path matched", () => {
    const [narrowed] = update(twoFiles(), TypedQuery({ query: "calendar" }))

    expect(drawnTree(narrowed)).toEqual([
      ["/app/src/calendar.catalog.ts", [["calendar", ["calendar/opens-on-today"]]]],
    ])
  })

  test("takes a folded file's rows out of the arrow keys' walk, because they are not on screen", () => {
    const model = initialModel(
      labCatalogOf(
        loadOf([
          at("/app/src/a.catalog.ts", "alpha/one"),
          at("/app/src/b.catalog.ts", "beta/one"),
          at("/app/src/c.catalog.ts", "gamma/one"),
        ]),
      ),
      bare,
    )
    const [folded] = update(model, ToggledFile({ path: "/app/src/b.catalog.ts" }))

    expect(neighbourId(model, 1)).toEqual(Option.some("beta/one"))
    expect(neighbourId(folded, 1)).toEqual(Option.some("gamma/one"))
  })

  test("folds a file shut by its path, which is what a file row's click does", () => {
    const [folded] = update(twoFiles(), ToggledFile({ path: "/app/src/button.catalog.ts" }))

    expect(isFileExpanded(folded, "/app/src/button.catalog.ts")).toBe(false)
    expect(isFileExpanded(folded, "/app/src/calendar.catalog.ts")).toBe(true)
    // Folded is about the file alone: the components under it are untouched, so
    // unfolding puts the reader back exactly where they were.
    expect(drawnTree(folded)).toEqual(drawnTree(twoFiles()))
  })
})

describe("counting what the canvas can draw", () => {
  const mixed = () =>
    initialModel(
      labCatalogOf(
        loadOf([
          { showcase: drawable("alpha/opens-clean") },
          { showcase: plain("button/counts-one-click") },
          { showcase: drawable("button/starts-unclicked") },
        ]),
      ),
      bare,
    )

  test("counts the entries declaring a mount, which is what the canvas can put on screen", () => {
    expect(drawableTotal(mixed())).toBe(2)
  })

  test("says how many of the drawn list can be drawn, without repeating the number beside it", () => {
    expect(drawableLabel(mixed())).toBe("2 drawable")
  })

  test("says all of them rather than the total twice, when every entry declares a mount", () => {
    const every = initialModel(
      labCatalogOf(loadOf([{ showcase: drawable("alpha/one") }, { showcase: drawable("alpha/two") }])),
      bare,
    )

    expect(drawableLabel(every)).toBe("all drawable")
  })

  test("says none rather than a zero, because a catalog with nothing to draw is a fact not a count", () => {
    expect(drawableLabel(initialModel(catalogOf("alpha/one"), bare))).toBe("none drawable")
  })

  test("counts nothing when no entry declares one, so a catalog of assertions says as much", () => {
    expect(drawableTotal(initialModel(catalogOf("alpha/one", "button/one"), bare))).toBe(0)
  })

  test("narrows with the filter, so the strip counts the list the reader is looking at", () => {
    const [model] = update(mixed(), TypedQuery({ query: "button/" }))

    expect(drawableTotal(model)).toBe(1)
    expect(matchingTotal(model)).toBe(2)
  })
})

describe("walking the sidebar by keyboard", () => {
  const three = () => initialModel(catalogOf("alpha/one", "button/one", "button/two"), bare)

  test("names the row below the selection, which is what an arrow key moves to", () => {
    expect(neighbourId(three(), 1)).toEqual(Option.some("button/one"))
  })

  test("names the row above the selection, crossing out of a component the way the eye does", () => {
    const [model] = update(three(), SelectedShowcase({ id: "button/one" }))

    expect(neighbourId(model, -1)).toEqual(Option.some("alpha/one"))
  })

  test("stops at the ends rather than wrapping, so holding a key cannot loop the catalog", () => {
    const [last] = update(three(), SelectedShowcase({ id: "button/two" }))

    expect(neighbourId(three(), -1)).toEqual(Option.none())
    expect(neighbourId(last, 1)).toEqual(Option.none())
  })

  test("walks what the sidebar draws, not what the catalog holds, so a filter narrows the walk", () => {
    const [chosen] = update(three(), SelectedShowcase({ id: "button/one" }))
    const [filtered] = update(chosen, TypedQuery({ query: "button" }))

    // `alpha/one` is still in the catalog, and a step up no longer reaches it.
    expect(neighbourId(filtered, -1)).toEqual(Option.none())
    expect(neighbourId(filtered, 1)).toEqual(Option.some("button/two"))
  })

  test("skips the rows a fold hid, because a row nobody can see is not the next one", () => {
    const [folded] = update(three(), ToggledComponent({ component: "button" }))

    expect(neighbourId(folded, 1)).toEqual(Option.none())
  })

  test("enters the list from the end it came from when nothing drawn is selected", () => {
    // The selection is `alpha/one`, which this filter took off the screen — so
    // there is no row to step from, and the step has to land somewhere sane.
    const [filtered] = update(three(), TypedQuery({ query: "button" }))

    expect(neighbourId(filtered, 1)).toEqual(Option.some("button/one"))
    expect(neighbourId(filtered, -1)).toEqual(Option.some("button/two"))
    expect(neighbourId({ ...filtered, maybeSelectedId: Option.none() }, 1)).toEqual(
      Option.some("button/one"),
    )
  })

  test("moves the selection and writes the address, so an arrow key is a navigation like a click", () => {
    const [model, commands] = update(three(), MovedSelection({ delta: 1 }))

    expect(model.maybeSelectedId).toEqual(Option.some("button/one"))
    expect(commands.map((command) => command.args)).toEqual([
      { address: "/?showcase=button%2Fone" },
    ])
  })

  test("moves nothing at the end of the list, and writes no address for a move that did not happen", () => {
    const [model, commands] = update(three(), MovedSelection({ delta: -1 }))

    expect(model.maybeSelectedId).toEqual(Option.some("alpha/one"))
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
