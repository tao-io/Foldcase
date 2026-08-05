import { describe, expect, test } from "bun:test"
import * as Option from "effect/Option"
import { fromString } from "foldkit/url"

import { type CatalogLoad, type LoadedShowcase, ShowcaseModuleError } from "../cli.js"
import type { Showcase } from "../runner.js"
import {
  catalogRoot,
  ChangedAddress,
  ClearedHistory,
  initialModel,
  isComponentExpanded,
  isSelected,
  matchingTotal,
  type Model,
  MovedSelection,
  neighbourId,
  PreviewDispatched,
  PreviewFailed,
  PreviewMounted,
  relativeFile,
  relayedTag,
  relayGapFrom,
  ReloadedCatalog,
  Remounted,
  SelectedPanel,
  SelectedShowcase,
  selectedEntry,
  SelectedTab,
  sidebarComponents,
  sidebarFailures,
  ToggledComponent,
  ToggledDrawer,
  ToggledTheme,
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

  test("records that the canvas painted without moving anything, because a mount is not a navigation", () => {
    const before = initialModel(catalogOf("button/one", "button/two"), bare)
    const [model, commands] = update(before, PreviewMounted({ id: "button/one" }))

    expect(model.maybeSelectedId).toEqual(before.maybeSelectedId)
    expect(commands).toEqual([])
  })
})

describe("the theme", () => {
  test("opens dark, which is the theme the design names as the default", () => {
    expect(initialModel(catalogOf("button/one"), bare).theme).toBe("dark")
  })

  test("swaps to light and back, so one control covers both directions", () => {
    const [light] = update(initialModel(catalogOf("button/one"), bare), ToggledTheme())
    const [dark] = update(light, ToggledTheme())

    expect(light.theme).toBe("light")
    expect(dark.theme).toBe("dark")
  })

  test("keeps the mount, because re-skinning is a cascade and not a rebuild", () => {
    const before = initialModel(catalogOf("button/one"), bare)
    const [painted] = update(before, PreviewMounted({ id: "button/one" }))
    const [light, commands] = update(painted, ToggledTheme())

    expect(light.mounted).toBe(true)
    expect(light.remounts).toBe(painted.remounts)
    expect(commands).toEqual([])
  })
})

describe("the canvas tabs and the addon drawer", () => {
  const opened = () => initialModel(catalogOf("button/one"), bare)

  test("opens on Canvas, on the Runtime panel, with the drawer open", () => {
    const model = opened()

    expect([model.tab, model.panel, model.drawerOpen]).toEqual(["canvas", "runtime", true])
  })

  test("moves to the tab that was chosen, and writes no address, because a tab is not a selection", () => {
    const [model, commands] = update(opened(), SelectedTab({ tab: "schema" }))

    expect(model.tab).toBe("schema")
    expect(commands).toEqual([])
  })

  test("moves to the drawer panel that was chosen", () => {
    const [model] = update(opened(), SelectedPanel({ panel: "absent" }))

    expect(model.panel).toBe("absent")
  })

  test("collapses the drawer and opens it again, so the strip is the only thing that stays", () => {
    const [shut] = update(opened(), ToggledDrawer())
    const [open] = update(shut, ToggledDrawer())

    expect(shut.drawerOpen).toBe(false)
    expect(open.drawerOpen).toBe(true)
  })

  test("keeps the tab when the selection moves, so walking the catalog stays on one reading", () => {
    const [schema] = update(
      initialModel(catalogOf("button/one", "button/two"), bare),
      SelectedTab({ tab: "entry" }),
    )
    const [moved] = update(schema, SelectedShowcase({ id: "button/two" }))

    expect(moved.tab).toBe("entry")
  })
})

describe("the mount, and whether it really painted", () => {
  const one = () => initialModel(catalogOf("button/one", "button/two"), bare)

  test("opens claiming nothing, because no paint has been verified yet", () => {
    expect(one().mounted).toBe(false)
  })

  test("claims a live mount only once a paint is reported", () => {
    const [model] = update(one(), PreviewMounted({ id: "button/one" }))

    expect(model.mounted).toBe(true)
  })

  test("says a mount failed rather than staying silent, so an empty card is never called Live", () => {
    const [painted] = update(one(), PreviewMounted({ id: "button/one" }))
    const [failed] = update(painted, PreviewFailed({ id: "button/one" }))

    expect(failed.mounted).toBe(false)
    expect(failed.previewFailed).toBe(true)
  })

  test("drops the claim when the selection moves, because the next mount has not painted yet", () => {
    const [painted] = update(one(), PreviewMounted({ id: "button/one" }))
    const [moved] = update(painted, SelectedShowcase({ id: "button/two" }))

    expect(moved.mounted).toBe(false)
    expect(moved.previewFailed).toBe(false)
  })

  test("rebuilds the preview on a remount, which is a new key and a Model back at init", () => {
    const [painted] = update(one(), PreviewMounted({ id: "button/one" }))
    const [again] = update(painted, Remounted())

    expect(again.remounts).toBe(painted.remounts + 1)
    expect(again.mounted).toBe(false)
  })
})

describe("the dispatch trail", () => {
  const one = () => initialModel(catalogOf("button/one", "button/two"), bare)

  test("opens empty, because nothing has been dispatched", () => {
    expect(one().trail).toEqual([])
  })

  test("appends one row per dispatch, keeping the delta the preview measured", () => {
    const [first] = update(one(), PreviewDispatched({ tag: "Clicked()", delta: 412 }))
    const [second] = update(first, PreviewDispatched({ tag: "ChangedStep({ step: 10 })", delta: 97 }))

    expect(second.trail).toEqual([
      // The first row has nothing before it, so its gap is zero however it
      // arrived; the second keeps the gap the edge measured.
      { tag: "Clicked()", delta: 0 },
      { tag: "ChangedStep({ step: 10 })", delta: 97 },
    ])
  })

  test("gives the first row a zero gap, because there is nothing before it to measure against", () => {
    const [first] = update(one(), PreviewDispatched({ tag: "Clicked()", delta: 9_000 }))
    const [cleared] = update(first, ClearedHistory())
    const [afresh] = update(cleared, PreviewDispatched({ tag: "Clicked()", delta: 9_000 }))

    expect(first.trail).toEqual([{ tag: "Clicked()", delta: 0 }])
    expect(afresh.trail).toEqual([{ tag: "Clicked()", delta: 0 }])
  })

  test("clears on request, on a remount, and on a new selection, so a trail names one mount only", () => {
    const [filled] = update(one(), PreviewDispatched({ tag: "Clicked()", delta: 1 }))

    expect(update(filled, ClearedHistory())[0].trail).toEqual([])
    expect(update(filled, Remounted())[0].trail).toEqual([])
    expect(update(filled, SelectedShowcase({ id: "button/two" }))[0].trail).toEqual([])
  })
})

describe("a Message relayed out of the preview", () => {
  test("reads the tag out of the envelope the protocol names", () => {
    expect(relayedTag({ foldcase: "dispatch", tag: "Clicked()" })).toEqual(
      Option.some("Clicked()"),
    )
  })

  test("ignores anything that is not that envelope, so a page full of chatter is not a trail", () => {
    expect(relayedTag({ tag: "Clicked()" })).toEqual(Option.none())
    expect(relayedTag({ foldcase: "something-else", tag: "Clicked()" })).toEqual(Option.none())
    expect(relayedTag({ foldcase: "dispatch" })).toEqual(Option.none())
    expect(relayedTag({ foldcase: "dispatch", tag: 7 })).toEqual(Option.none())
    expect(relayedTag("Clicked()")).toEqual(Option.none())
    expect(relayedTag(null)).toEqual(Option.none())
  })

  test("measures the gap itself rather than trusting what was sent", () => {
    expect(relayGapFrom(undefined, 1_000)).toBe(0)
    expect(relayGapFrom(1_000, 1_412)).toBe(412)
    expect(relayGapFrom(1_000, 1_412.6)).toBe(413)
    // A clock that went backwards is a zero, not a negative gap.
    expect(relayGapFrom(2_000, 1_000)).toBe(0)
  })
})

describe("reloading the catalog", () => {
  test("says it is reloading and leaves for the address it is on, which is what rebuilds the tree", () => {
    const model = initialModel(
      catalogOf("button/one"),
      urlOf("http://localhost:5198/?showcase=button%2Fone"),
    )
    const [reloading, commands] = update(model, ReloadedCatalog())

    expect(reloading.reloading).toBe(true)
    expect(commands.map((command) => [command.name, command.args])).toEqual([
      ["LeavePage", { href: "http://localhost:5198/?showcase=button%2Fone" }],
    ])
  })

  test("is idempotent while it runs, so a second click cannot start a second reload", () => {
    const model = initialModel(catalogOf("button/one"), bare)
    const [reloading] = update(model, ReloadedCatalog())
    const [again, commands] = update(reloading, ReloadedCatalog())

    expect(again.reloading).toBe(true)
    expect(commands).toEqual([])
  })
})

describe("the catalog root, and the path the tab bar shows", () => {
  const at = (file: string, id: string): LoadedShowcase => ({ file, showcase: plain(id) })

  test("is the deepest directory every file shares, so the path left is the part that differs", () => {
    const catalog = labCatalogOf(
      loadOf([
        at("/app/src/ui/button.showcase.ts", "button/one"),
        at("/app/src/ui/forms/input.showcase.ts", "input/one"),
      ]),
    )

    expect(catalogRoot(catalog)).toBe("/app/src/ui")
  })

  test("is the file's own directory when one file holds the whole catalog", () => {
    const catalog = labCatalogOf(loadOf([at("/app/src/button.showcase.ts", "button/one")]))

    expect(catalogRoot(catalog)).toBe("/app/src")
  })

  test("is empty for a catalog no file backs, so an in-memory catalog names no root", () => {
    expect(catalogRoot(catalogOf("button/one"))).toBe("")
  })

  test("stops at a directory boundary rather than at a shared prefix of two names", () => {
    const catalog = labCatalogOf(
      loadOf([at("/app/button.showcase.ts", "button/one"), at("/app/butter.showcase.ts", "butter/one")]),
    )

    expect(catalogRoot(catalog)).toBe("/app")
  })

  test("shows the path relative to that root, which is the part a reader has not already read", () => {
    expect(relativeFile("/app/src/ui", "/app/src/ui/forms/input.showcase.ts")).toBe(
      "forms/input.showcase.ts",
    )
    expect(relativeFile("", "/app/src/button.showcase.ts")).toBe("/app/src/button.showcase.ts")
    expect(relativeFile("/app/src", "/elsewhere/button.showcase.ts")).toBe(
      "/elsewhere/button.showcase.ts",
    )
  })
})

describe("the files the loader could not read", () => {
  const failing = (path: string) =>
    new ShowcaseModuleError({ path, reason: "Cannot find module" })

  const model = () =>
    initialModel(
      labCatalogOf(
        loadOf(
          [{ file: "/app/src/button.showcase.ts", showcase: plain("button/one") }],
          [failing("/app/src/broken.showcase.ts"), failing("/app/src/also-broken.showcase.ts")],
        ),
      ),
      bare,
    )

  test("names every failure, in path order, because a missing component is a question the tree answers", () => {
    expect(sidebarFailures(model()).map((failure) => failure.path)).toEqual([
      "/app/src/also-broken.showcase.ts",
      "/app/src/broken.showcase.ts",
    ])
  })

  test("narrows with the filter on the one name such a file has, which is its path", () => {
    const [narrowed] = update(model(), TypedQuery({ query: "also" }))

    expect(sidebarFailures(narrowed).map((failure) => failure.path)).toEqual([
      "/app/src/also-broken.showcase.ts",
    ])
  })

  test("drops out when the filter matched a component instead", () => {
    const [narrowed] = update(model(), TypedQuery({ query: "button" }))

    expect(sidebarFailures(narrowed)).toEqual([])
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
  test("opens with only the selection's component unfolded, so a catalog is one screen of names", () => {
    const model = initialModel(catalogOf("alpha/one", "button/one"), bare)

    expect(model.collapsedComponents).toEqual(["button"])
    expect(isComponentExpanded(model, "alpha")).toBe(true)
    expect(isComponentExpanded(model, "button")).toBe(false)
  })

  test("unfolds the component the address named, not the first one, on a cold deep link", () => {
    const model = initialModel(
      catalogOf("alpha/one", "button/one"),
      urlOf("http://localhost:5198/?showcase=button%2Fone"),
    )

    expect(isComponentExpanded(model, "button")).toBe(true)
    expect(isComponentExpanded(model, "alpha")).toBe(false)
  })

  test("folds the component that was toggled, and unfolds it when it is toggled again", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [unfolded] = update(before, ToggledComponent({ component: "button" }))
    const [folded] = update(unfolded, ToggledComponent({ component: "button" }))

    expect(isComponentExpanded(unfolded, "button")).toBe(true)
    expect(isComponentExpanded(folded, "button")).toBe(false)
    expect(isComponentExpanded(folded, "alpha")).toBe(true)
  })

  test("folds nothing but the component named, however many are folded already", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one", "card/one"), bare)
    const [one] = update(before, ToggledComponent({ component: "button" }))
    const [two] = update(one, ToggledComponent({ component: "card" }))

    expect(isComponentExpanded(two, "alpha")).toBe(true)
    expect(isComponentExpanded(two, "button")).toBe(true)
    expect(isComponentExpanded(two, "card")).toBe(true)
  })

  test("folds the component holding the selection, so the click the reader made is the one they see", () => {
    const before = initialModel(
      catalogOf("alpha/one", "button/one"),
      urlOf("http://localhost:5198/?showcase=button%2Fone"),
    )
    const [folded] = update(before, ToggledComponent({ component: "button" }))

    expect(isComponentExpanded(folded, "button")).toBe(false)
  })

  test("unfolds the component a chosen Showcase belongs to, so a selection is never hidden", () => {
    const before = initialModel(catalogOf("alpha/one", "button/one"), bare)
    const [folded] = update(before, ToggledComponent({ component: "button" }))
    const [chosen] = update(folded, SelectedShowcase({ id: "button/one" }))

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
    const [arrived] = update(
      before,
      ChangedAddress({ url: urlOf("http://localhost:5198/?showcase=button%2Fnope") }),
    )

    expect(isComponentExpanded(arrived, "button")).toBe(false)
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
    const folded = wide()

    expect(drawn(folded)).toEqual([
      ["alpha", ["alpha/opens-clean"]],
      ["button", ["button/counts-one-click", "button/starts-unclicked"]],
    ])
  })

  test("shows a match inside a folded component, because a filter that hides its own hits is a lie", () => {
    const [filtered] = update(wide(), TypedQuery({ query: "counts" }))

    expect(isComponentExpanded(filtered, "button")).toBe(true)
    expect(drawn(filtered)).toEqual([["button", ["button/counts-one-click"]]])
  })

  test("draws nothing at all when what was typed matches no id, so the sidebar can say so", () => {
    const [model] = update(wide(), TypedQuery({ query: "nothing-is-called-this" }))

    expect(drawn(model)).toEqual([])
    expect(matchingTotal(model)).toBe(0)
  })
})

describe("walking the sidebar by keyboard", () => {
  const three = () => initialModel(catalogOf("alpha/one", "button/one", "button/two"), bare)

  /** The same three, with every group opened, which is what a click leaves behind. */
  const open = () => ({ ...three(), collapsedComponents: [] })

  test("names the row below the selection, which is what an arrow key moves to", () => {
    expect(neighbourId(open(), 1)).toEqual(Option.some("button/one"))
  })

  test("names the row above the selection, crossing out of a component the way the eye does", () => {
    const [model] = update(open(), SelectedShowcase({ id: "button/one" }))

    expect(neighbourId(model, -1)).toEqual(Option.some("alpha/one"))
  })

  test("stops at the ends rather than wrapping, so holding a key cannot loop the catalog", () => {
    const [last] = update(open(), SelectedShowcase({ id: "button/two" }))

    expect(neighbourId(open(), -1)).toEqual(Option.none())
    expect(neighbourId(last, 1)).toEqual(Option.none())
  })

  test("walks what the sidebar draws, not what the catalog holds, so a filter narrows the walk", () => {
    const [chosen] = update(open(), SelectedShowcase({ id: "button/one" }))
    const [filtered] = update(chosen, TypedQuery({ query: "button" }))

    // `alpha/one` is still in the catalog, and a step up no longer reaches it.
    expect(neighbourId(filtered, -1)).toEqual(Option.none())
    expect(neighbourId(filtered, 1)).toEqual(Option.some("button/two"))
  })

  test("skips the rows a fold hid, because a row nobody can see is not the next one", () => {
    // `alpha` holds the selection and is open; `button` opens folded.
    expect(neighbourId(three(), 1)).toEqual(Option.none())
  })

  test("enters the list from the end it came from when nothing drawn is selected", () => {
    // The selection is `alpha/one`, which this filter took off the screen — so
    // there is no row to step from, and the step has to land somewhere sane.
    const [filtered] = update(open(), TypedQuery({ query: "button" }))

    expect(neighbourId(filtered, 1)).toEqual(Option.some("button/one"))
    expect(neighbourId(filtered, -1)).toEqual(Option.some("button/two"))
    expect(neighbourId({ ...filtered, maybeSelectedId: Option.none() }, 1)).toEqual(
      Option.some("button/one"),
    )
  })

  test("moves the selection and writes the address, so an arrow key is a navigation like a click", () => {
    const [model, commands] = update(open(), MovedSelection({ delta: 1 }))

    expect(model.maybeSelectedId).toEqual(Option.some("button/one"))
    expect(commands.map((command) => command.args)).toEqual([
      { address: "/?showcase=button%2Fone" },
    ])
  })

  test("moves nothing at the end of the list, and writes no address for a move that did not happen", () => {
    const [model, commands] = update(open(), MovedSelection({ delta: -1 }))

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
