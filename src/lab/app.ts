import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as M from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"
import { Command, Mount, Runtime, Subscription } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { m } from "foldkit/message"
import { load, pushUrl, UrlRequest } from "foldkit/navigation"
import type { DevToolsConfig, MakeRuntimeReturn } from "foldkit/runtime"
import { Url, toString as urlToString } from "foldkit/url"

import type { CatalogLoad } from "../cli.js"
import { addressedId, addressOf } from "./address.js"
import type { LabEntry } from "./catalog.js"
import { LabCatalog, labCatalogOf, LabComponent } from "./catalog.js"

// THE FOUR READINGS, AND THE FOUR PANELS

/**
 * What the main pane is showing about the selected entry.
 *
 * Four readings of one record, and every one of them is the record: `canvas`
 * mounts it, `entry` prints the six fields the listing carries, `timeline`
 * records what a live mount dispatched, and `schema` says what the Message and
 * Model documents actually are. None of them invents a fact.
 */
export const Tab = Schema.Literals(["canvas", "entry", "timeline", "schema"])
export type Tab = typeof Tab.Type

/**
 * Which panel the addon drawer is showing. `absent` is the load-bearing one: it
 * is the list of fields a catalog browser usually shows and this catalog does
 * not carry, said in the UI rather than papered over with a placeholder that
 * reads as a value.
 */
export const Panel = Schema.Literals(["runtime", "absent", "agent", "json"])
export type Panel = typeof Panel.Type

/** The palette. Dark is the default, and a reader's choice outranks the machine's. */
export const Theme = Schema.Literals(["dark", "light"])
export type Theme = typeof Theme.Type

// MESSAGE

/**
 * A reader chose a Showcase from the sidebar — and so, unchanged, does an
 * agent. The Message union below is handed to `devTools`, which is what lets
 * `@foldkit/devtools-mcp`'s `foldkit_dispatch_message` drive this lab: every
 * navigation a human performs by clicking is `SelectedShowcase({ id })`, keyed
 * by the very ids `foldcase_list_showcases` already serves. That is the whole
 * agent surface, and it costs no new MCP tool.
 */
export const SelectedShowcase = m("SelectedShowcase", { id: Schema.String })

/**
 * The preview painted: the slot was handed to the Showcase's `mount`, and a
 * tick later the slot had children.
 *
 * The check is the point. `Runtime.run` returns `undefined` and throws nothing
 * when a Foldkit application paints nothing at all, so "the module loaded" is
 * not evidence of anything. The lab says a mount is live only when it has seen
 * the paint, which is what stops an empty card being labelled Live.
 */
export const PreviewMounted = m("PreviewMounted", { id: Schema.String })

/** The same check, come back empty. A silent failure, said out loud. */
export const PreviewFailed = m("PreviewFailed", { id: Schema.String })

/**
 * A Message reached the mounted component's own `update`, relayed out of the
 * preview with the gap since the one before it. The shell records the tag and
 * the delta and reads neither: they are the mounted component's type, not the
 * lab's.
 */
export const PreviewDispatched = m("PreviewDispatched", {
  tag: Schema.String,
  delta: Schema.Number,
})

/** A reader emptied the trail, which is a statement about the list and nothing else. */
export const ClearedHistory = m("ClearedHistory")

/**
 * The envelope a mounted component posts to put a Message on the trail.
 *
 * Foldkit gives a host no read on a runtime it did not build: the store that
 * records Messages is closure-local to that runtime, ports are declared by the
 * app itself, and there is no registry to look one up in. So the relay is the
 * mount's to make, and this is the shape it makes it in —
 * `window.postMessage({ foldcase: "dispatch", tag })`, which is the same channel
 * the design's prototype relayed its own frame's dispatches over.
 *
 * It carries the tag and nothing else. The gap between Messages is measured
 * here rather than sent, because a sender's clock is a sender's claim, and the
 * trail is the lab saying what it saw.
 */
const PreviewRelay = Schema.Struct({
  foldcase: Schema.Literals(["dispatch"]),
  tag: Schema.String,
})

const decodeRelay = Schema.decodeUnknownOption(PreviewRelay)

/**
 * The tag in a relayed Message, if what arrived was one.
 *
 * A page is full of `message` events — a dev server's own socket, an extension,
 * another frame — so anything that is not this envelope is dropped rather than
 * guessed at. Decoding is `Schema`'s job because the payload crosses a boundary.
 */
export const relayedTag = (data: unknown): Option.Option<string> =>
  Option.map(decodeRelay(data), (relay) => relay.tag)

/**
 * The gap the trail records: whole milliseconds since the Message before it.
 *
 * The first Message has nothing to be measured against, so it is zero rather
 * than the age of the page. A clock that went backwards is zero too — a
 * negative gap is a reading nobody can use.
 */
export const relayGapFrom = (previous: number | undefined, now: number): number =>
  previous === undefined ? 0 : Math.max(0, Math.round(now - previous))

/**
 * A reader asked for the preview to be built again: the Model back at `init`
 * and the trail empty. It carries no id because the selection already names
 * what is being rebuilt.
 */
export const Remounted = m("Remounted")

/** A reader chose one of the four readings of the selected entry. */
export const SelectedTab = m("SelectedTab", { tab: Tab })

/** A reader chose one of the four panels in the addon drawer. */
export const SelectedPanel = m("SelectedPanel", { panel: Panel })

/** A reader collapsed the drawer to its strip, or opened it again. */
export const ToggledDrawer = m("ToggledDrawer")

/**
 * A reader swapped the palette. It is a Message and not a media query because a
 * reader looking at a light component on a dark machine has to be able to say
 * so — the `data-theme` attribute the view writes outranks
 * `prefers-color-scheme` for exactly that reason.
 */
export const ToggledTheme = m("ToggledTheme")

/**
 * A reader asked for the catalog again.
 *
 * In the browser the catalog is whatever the consumer's entry module imported,
 * so reloading it means reloading the page: the dev server re-reads the files,
 * the entry module imports them again, and the tree is rebuilt from what came
 * back. The address carries the selection, so the reader lands where they were.
 */
export const ReloadedCatalog = m("ReloadedCatalog")

/**
 * A reader folded a component's group shut, or opened it again. A catalog of a
 * few hundred entries is a column no screen holds, and this is how it becomes
 * one screen of component names — an affordance an agent has too, by the same
 * dispatch, keyed by the component names `foldcase_list_showcases` serves.
 */
export const ToggledComponent = m("ToggledComponent", { component: Schema.String })

/**
 * A reader narrowed the catalog to the ids holding what they typed. A few
 * hundred entries is more than a fold can rescue — folding costs a click per
 * component and answers "which component", where a filter answers "which
 * Showcase" in one gesture. An agent has the same affordance by the same
 * dispatch, which is how it reaches an id it only half remembers.
 */
export const TypedQuery = m("TypedQuery", { query: Schema.String })

/**
 * A reader walked the sidebar with an arrow key. It carries a step and not an
 * id because the reader is naming a direction, not a Showcase — what lies one
 * step away depends on the filter and the folds, and `update` is the one place
 * that knows both.
 */
export const MovedSelection = m("MovedSelection", { delta: Schema.Number })

/**
 * The sidebar scrolled the chosen row into view. A Mount has to name a result
 * Message, so this is the acknowledgement `update` records and does nothing
 * with — the scroll is the whole of the work.
 */
export const RevealedSelection = m("RevealedSelection", { id: Schema.String })

/**
 * The address changed under the lab — a reader edited the bar, went back, or
 * followed a link — and the lab reads the selection back out of it. Every
 * address the lab itself writes arrives here too, because `pushUrl` announces
 * the change, so this is the one place the address becomes a selection.
 */
export const ChangedAddress = m("ChangedAddress", { url: Url })

/**
 * A link inside the lab was clicked. The lab's own view holds none, but an
 * embedded component's might, and the runtime intercepts those too — so this
 * arm exists to navigate honestly rather than to swallow the click.
 */
export const RequestedAddress = m("RequestedAddress", { request: UrlRequest })

/** The address is written. The acknowledgement `update` records and drops. */
export const WroteAddress = m("WroteAddress")

/** The page is leaving for somewhere the lab does not own. Same, and terminal. */
export const LeftForPage = m("LeftForPage")

export const Message = Schema.Union([
  SelectedShowcase,
  PreviewMounted,
  PreviewFailed,
  PreviewDispatched,
  ClearedHistory,
  Remounted,
  SelectedTab,
  SelectedPanel,
  ToggledDrawer,
  ToggledTheme,
  ReloadedCatalog,
  ToggledComponent,
  TypedQuery,
  MovedSelection,
  RevealedSelection,
  ChangedAddress,
  RequestedAddress,
  WroteAddress,
  LeftForPage,
])
export type Message = typeof Message.Type

// COMMAND

/**
 * Writing the address is a Command and not a side effect in `update`, which is
 * what keeps the rule above testable: the test reads the address off the
 * Command it was handed and never opens a browser.
 */
const WriteAddress = Command.define("WriteAddress", {
  args: { address: Schema.String },
  messages: [WroteAddress],
  execute: ({ address }) => pushUrl(address).pipe(Effect.as(WroteAddress())),
})

/** Leaving for another origin, the one navigation the lab does not come back from. */
const LeavePage = Command.define("LeavePage", {
  args: { href: Schema.String },
  messages: [LeftForPage],
  execute: ({ href }) => load(href).pipe(Effect.as(LeftForPage())),
})

// MODEL

/**
 * What the lab shell holds: the document the catalog projection produced, the
 * address it is at, and which entry the reader is looking at.
 *
 * `url` is here because the selection *is* the address: `update` has to write
 * the next address against the one the page is on, so that the consumer's own
 * path, hash and query parameters survive a move (see `./address.ts`). Keeping
 * it in the Model is what keeps that rule pure.
 *
 * `maybeUnknownId` is the id an address named that the catalog does not
 * declare. It is held rather than dropped so the lab can say so: an address a
 * reader mistyped or an agent guessed must not read as an empty gallery.
 *
 * `collapsedComponents` is which groups the reader folded shut. It is the names
 * and not a flag per entry, because a component is an id namespace and folding
 * is a statement about the namespace; and it is an array and not a `Set`
 * because a Model is a Schema and has to encode.
 *
 * `query` is what the reader typed to narrow the catalog. It is held raw —
 * neither trimmed nor lowered — because it is also what the input draws, and a
 * field that rewrites what is being typed into it is a field nobody can type a
 * space into. `sidebarComponents` normalises it at the point of comparison.
 *
 * `mounted` is whether the preview has been *seen* to paint, and it is set from
 * `PreviewMounted` alone. Nothing derives it from "the selection declares a
 * mount": `Runtime.run` returns `undefined` and throws nothing when a Foldkit
 * application paints an empty container, so an assumed mount is exactly the
 * failure the lab would then label Live. `previewFailed` is the other half —
 * the check ran and came back empty — so an empty card says why.
 *
 * `remounts` is a counter and not a flag. It rides in the preview slot's key,
 * so asking for a remount destroys the slot and builds a new one, which is what
 * runs the teardown and takes the component's Model back to `init`.
 *
 * `trail` is what the mounted component dispatched, tag and measured gap. The
 * shell records it and reads none of it: those Messages are the component's
 * type, not the lab's.
 *
 * The `mount` thunks are deliberately **not** here. A Model is a Schema, and a
 * closure has no encoding — so the factory closes over them, keyed by id,
 * exactly as the document is keyed. The Model carries the id, and the id is
 * enough to find the thunk again.
 */
export const TrailEntry = Schema.Struct({ tag: Schema.String, delta: Schema.Number })
export type TrailEntry = typeof TrailEntry.Type

export const Model = Schema.Struct({
  catalog: LabCatalog,
  url: Url,
  maybeSelectedId: Schema.Option(Schema.String),
  maybeUnknownId: Schema.Option(Schema.String),
  collapsedComponents: Schema.Array(Schema.String),
  query: Schema.String,
  theme: Theme,
  tab: Tab,
  panel: Panel,
  drawerOpen: Schema.Boolean,
  reloading: Schema.Boolean,
  mounted: Schema.Boolean,
  previewFailed: Schema.Boolean,
  remounts: Schema.Number,
  trail: Schema.Array(TrailEntry),
})
export type Model = typeof Model.Type

const idsOf = (catalog: LabCatalog): ReadonlyArray<string> =>
  entriesOf(catalog).map((entry) => entry.id)

/** What the selection becomes when an address names an id — or names none. */
type Selection = Pick<Model, "maybeSelectedId" | "maybeUnknownId">

/**
 * The one rule for reading an address into a selection, and every entrance uses
 * it: the first render, a later URL change, and a Message an agent dispatched.
 *
 * An address that names nothing leaves the selection where it is — on the first
 * render that is the default entry, and later it is whatever the reader was
 * looking at, so a link out of an embedded component cannot quietly move the
 * gallery. An address that names an id the catalog does not declare leaves the
 * selection alone too, and keeps the id, because the lab has to say it looked
 * and did not find it rather than draw nothing and let the reader guess.
 */
const selectionAt = (model: Model, maybeId: Option.Option<string>): Selection =>
  pipe(
    maybeId,
    Option.match({
      onNone: (): Selection => ({
        maybeSelectedId: model.maybeSelectedId,
        maybeUnknownId: Option.none(),
      }),
      onSome: (id): Selection =>
        Arr.contains(idsOf(model.catalog), id)
          ? { maybeSelectedId: Option.some(id), maybeUnknownId: Option.none() }
          : { maybeSelectedId: model.maybeSelectedId, maybeUnknownId: Option.some(id) },
    }),
  )

/**
 * The folds a selection leaves behind: the same ones, less the component the
 * selection just arrived in.
 *
 * This is the other half of dropping the old "the group holding the selection
 * is open whatever the reader folded" rule. Arriving opens the group, once, and
 * then the fold is the reader's again — so a deep link, a back button and an
 * agent's dispatch all land on a row that is on screen, and the fold button
 * never has a click to decline. A selection that did not move, or an id the
 * catalog does not declare, unfolds nothing.
 */
const unfoldedAt = (model: Model, selection: Selection): Pick<Model, "collapsedComponents"> =>
  pipe(
    selection.maybeSelectedId,
    Option.flatMap((id) => Arr.findFirst(entriesOf(model.catalog), (entry) => entry.id === id)),
    Option.match({
      onNone: () => ({ collapsedComponents: model.collapsedComponents }),
      onSome: (entry) => ({
        collapsedComponents: Arr.filter(
          model.collapsedComponents,
          (name) => name !== entry.component,
        ),
      }),
    }),
  )

/**
 * The Model a lab opens on: the whole document, showing the entry the address
 * names, or its first entry in id order when the address names none. An empty
 * catalog opens on nothing, which is the honest answer rather than a selection
 * of something that is not there.
 */
export const initialModel = (catalog: LabCatalog, url: Url): Model => {
  const opened: Model = {
    catalog,
    url,
    maybeSelectedId: Arr.head(idsOf(catalog)),
    maybeUnknownId: Option.none(),
    // Filled below, once the address has said which component is the one that
    // opens. A catalog of a few hundred entries is a column no screen holds,
    // and a tree that opens as a list of component names is a tree a reader can
    // read; the group holding what is drawn is the one exception, because it
    // has to show the row it is drawing.
    collapsedComponents: [],
    // And nothing filtered, for the same reason.
    query: "",
    theme: "dark",
    tab: "canvas",
    panel: "runtime",
    drawerOpen: true,
    reloading: false,
    // Nothing has painted, so nothing claims to have.
    mounted: false,
    previewFailed: false,
    remounts: 0,
    trail: [],
  }
  const selection = selectionAt(opened, addressedId(url))
  const shown = pipe(
    selection.maybeSelectedId,
    Option.flatMap((id) => Arr.findFirst(entriesOf(catalog), (entry) => entry.id === id)),
    Option.map((entry) => entry.component),
  )
  return {
    ...opened,
    ...selection,
    collapsedComponents: catalog.components
      .map((component) => component.component)
      .filter((name) => !Option.contains(shown, name)),
  }
}

const entriesOf = (catalog: LabCatalog): ReadonlyArray<LabEntry> =>
  catalog.components.flatMap((component) => component.entries)

/**
 * The entry the selection names, if it names one. The details panel and the
 * canvas both ask this rather than searching the document a second time, so
 * there is one answer to "what am I looking at" and the view cannot disagree
 * with itself.
 */
export const selectedEntry = (model: Model): Option.Option<LabEntry> =>
  pipe(
    model.maybeSelectedId,
    Option.flatMap((id) => Arr.findFirst(entriesOf(model.catalog), (entry) => entry.id === id)),
  )

/**
 * Whether the sidebar draws this row as the chosen one. The row's look, its
 * `data-selected` and the scroll that brings it into view all ask this, so
 * there is one answer and three readings of it cannot drift apart.
 */
export const isSelected = (model: Model, id: string): boolean =>
  Option.contains(model.maybeSelectedId, id)

/**
 * Whether a component's group shows its entries.
 *
 * Folded is the reader's word, with one rule over it: a live filter opens
 * everything it matched. A filter that hid its own hits behind a fold the
 * reader set ten minutes ago would be a filter that lies about the catalog.
 *
 * The group holding the selection has no such privilege. It used to, so that a
 * deep link could never land on a hidden row — but the cost was a fold button
 * that swallowed the click and then applied it later, when the reader had moved
 * on and the sidebar reshuffled under them. The rule that replaces it lives in
 * `update`: arriving at a Showcase opens the component it belongs to. Feedback
 * is immediate either way, and no click is ever silently declined.
 */
export const isComponentExpanded = (model: Model, component: string): boolean =>
  normalisedQuery(model) !== "" || !Arr.contains(model.collapsedComponents, component)

/** What the reader typed, as it is actually compared: trimmed and lowered. */
const normalisedQuery = (model: Model): string => model.query.trim().toLowerCase()

/** Whether an entry survives the filter. An empty filter is not a filter. */
const matchesQuery = (entry: LabEntry, query: string): boolean =>
  query === "" || entry.id.toLowerCase().includes(query)

/**
 * The catalog as the sidebar draws it: the components that still hold a match,
 * each carrying the rows to render under its heading.
 *
 * This is the filter and nothing else — a component keeps every entry that
 * matched, whether or not a fold is hiding them. The fold is drawn on top of
 * this by whoever is drawing, because the heading has to say how many entries
 * it is hiding, and a function that had already dropped them could not.
 * A component the filter emptied is dropped outright, heading and all, since
 * there would be nothing under it to unfold.
 */
export const sidebarComponents = (model: Model): ReadonlyArray<LabComponent> => {
  const query = normalisedQuery(model)
  return Arr.flatMap(model.catalog.components, (component) => {
    const entries = Arr.filter(component.entries, (entry) => matchesQuery(entry, query))
    return entries.length === 0
      ? []
      : [new LabComponent({ component: component.component, entries })]
  })
}

/**
 * The files the loader could not read, as the sidebar draws them: in path
 * order, and narrowed by the filter on the one name such a file has.
 *
 * A file that would not load declared no id, so it has no component to hang
 * under and no entry to be found by. It is still the answer to "where did that
 * component go", which is why it is a row in the tree rather than a panel over
 * it (ADR-0001 › Amendment 2), and why the filter matches its path: narrowing
 * by a component name that is missing has to be able to find the file that was
 * supposed to declare it.
 */
export const sidebarFailures = (model: Model): LabCatalog["failures"] => {
  const query = normalisedQuery(model)
  return Arr.sort(
    Arr.filter(
      model.catalog.failures,
      (failure) => query === "" || failure.path.toLowerCase().includes(query),
    ),
    byFailurePath,
  )
}

const byFailurePath = Order.mapInput(
  Order.String,
  (failure: LabCatalog["failures"][number]) => failure.path,
)

/**
 * The deepest directory every declared file shares.
 *
 * The tab bar names the file the selection came from, and in a real catalog
 * that path is mostly the same forty characters on every row — the part a
 * reader has already read. Stripping the shared root leaves the part that
 * differs, which is the part that says anything.
 *
 * It stops at a directory boundary rather than at a shared prefix of two
 * names, so `button.ts` and `butter.ts` share their directory and not `butt`.
 * A catalog no file backs shares nothing, and says so with an empty root.
 */
export const catalogRoot = (catalog: LabCatalog): string => {
  const directories = catalog.components
    .flatMap((component) => component.entries)
    .flatMap((entry) => (entry.file === undefined ? [] : [directoryOf(entry.file)]))
  return Arr.reduce(directories, Arr.head(directories).pipe(Option.getOrElse(() => "")), sharedPath)
}

/** Everything before a path's last separator — the directory that holds it. */
const directoryOf = (file: string): string => file.slice(0, file.lastIndexOf("/"))

/** The longest run of whole segments two paths open with. */
const sharedPath = (left: string, right: string): string => {
  const shared: Array<string> = []
  const rightSegments = right.split("/")
  left.split("/").forEach((segment, at) => {
    if (shared.length === at && rightSegments[at] === segment) {
      shared.push(segment)
    }
  })
  return shared.join("/")
}

/**
 * A file as the tab bar says it: relative to the catalog root, or whole when it
 * is not under that root at all. A path that would be rewritten into something
 * a reader cannot find on disk is worse than the long one.
 */
export const relativeFile = (root: string, file: string): string =>
  root !== "" && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file


/**
 * How many Showcases the filter left. The header says this against the catalog
 * total, so a reader who typed something that matched three of a hundred and
 * forty-six reads that it matched three — rather than reading a short list and
 * assuming the catalog is short.
 */
export const matchingTotal = (model: Model): number => {
  const query = normalisedQuery(model)
  return Arr.filter(entriesOf(model.catalog), (entry) => matchesQuery(entry, query)).length
}

/**
 * The id one step from the selection, in the order the sidebar draws.
 *
 * It walks {@link sidebarComponents} and not the catalog, so an arrow key moves
 * between the rows on screen: a filter narrows the walk to what it matched, and
 * a fold takes its rows out of it. A step past either end is `none` rather than
 * the other end, because a keyboard held down should stop at the edge of the
 * list instead of quietly starting it again. When nothing drawn is selected the
 * step enters the list from the end it came from.
 */
export const neighbourId = (model: Model, delta: number): Option.Option<string> => {
  const drawn = sidebarComponents(model)
    .filter((component) => isComponentExpanded(model, component.component))
    .flatMap((component) => component.entries.map((entry) => entry.id))
  const at = pipe(
    model.maybeSelectedId,
    Option.flatMap((id) => Arr.findFirstIndex(drawn, (drawnId) => drawnId === id)),
    Option.getOrElse(() => (delta > 0 ? -1 : drawn.length)),
  )
  return Arr.get(drawn, at + delta)
}

// UPDATE

/**
 * Arriving at a Showcase, however the reader got there: a click, an arrow key,
 * or an agent's dispatch. All three take the same route so all three answer the
 * same way — the selection moves, the group it landed in opens, and the address
 * is written unless the id was one the catalog never declared.
 */
const chose = (
  model: Model,
  id: string,
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  const selection = selectionAt(model, Option.some(id))
  return [
    { ...model, ...selection, ...unfoldedAt(model, selection), ...freshPreview },
    Option.isNone(selection.maybeUnknownId)
      ? [WriteAddress({ address: addressOf(model.url, id) })]
      : [],
  ]
}

/**
 * What the preview is before anything has happened to it: nothing painted,
 * nothing failed, nothing dispatched.
 *
 * Arriving at a Showcase resets all three, because the card is about to be
 * rebuilt for a different component — a trail carried over from the last one
 * would attribute its Messages to this one, and a `mounted` carried over would
 * label an empty card Live for the tick before the new mount reports.
 */
const freshPreview: Pick<Model, "mounted" | "previewFailed" | "trail"> = {
  mounted: false,
  previewFailed: false,
  trail: [],
}

/**
 * Pure, and the whole of the lab's behaviour: the sidebar moves the selection,
 * the selection writes the address, the address moves the selection back, and
 * the canvas reports that it drew. Everything the browser does lives in the
 * view, the Mount and the two Commands, so this is unit-testable with no DOM
 * under it.
 *
 * An id the catalog does not declare never becomes the selection, and it is
 * never written to the address either — but it is kept and shown, so a reader
 * who mistyped and an agent who guessed both get told. A dispatch that came
 * from an agent gets the same answer as a click that came from a reader.
 */
export const update = (
  model: Model,
  message: Message,
): readonly [Model, ReadonlyArray<Command.Command<Message>>] =>
  pipe(
    M.value(message),
    M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(),
    M.tagsExhaustive({
      SelectedShowcase: ({ id }) => chose(model, id),
      MovedSelection: ({ delta }) =>
        pipe(
          neighbourId(model, delta),
          Option.match({
            onNone: (): readonly [Model, ReadonlyArray<Command.Command<Message>>] => [model, []],
            onSome: (id) => chose(model, id),
          }),
        ),
      ChangedAddress: ({ url }) => {
        const selection = selectionAt(model, addressedId(url))
        const moved = !pipe(
          selection.maybeSelectedId,
          Option.match({
            onNone: () => Option.isNone(model.maybeSelectedId),
            onSome: (id) => Option.contains(model.maybeSelectedId, id),
          }),
        )
        return [
          {
            ...model,
            url,
            ...selection,
            ...unfoldedAt(model, selection),
            // A back button that landed on another Showcase resets the preview
            // exactly as a click would; one that only changed a query parameter
            // leaves a live mount alone.
            ...(moved ? freshPreview : {}),
          },
          [],
        ]
      },
      RequestedAddress: ({ request }) =>
        pipe(
          M.value(request),
          M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(),
          M.tagsExhaustive({
            Internal: ({ url }) => [model, [WriteAddress({ address: urlToString(url) })]],
            External: ({ href }) => [model, [LeavePage({ href })]],
          }),
        ),
      // The four readings, the four panels and the drawer are statements about
      // what is on screen and nothing else: no address is written, because a
      // reading is not a selection and a link to one would be a link to a mood.
      SelectedTab: ({ tab }) => [{ ...model, tab }, []],
      SelectedPanel: ({ panel }) => [{ ...model, panel }, []],
      ToggledDrawer: () => [{ ...model, drawerOpen: !model.drawerOpen }, []],
      // The palette is a cascade: the whole shell and the preview inside it
      // read the same custom properties, so swapping the attribute re-skins
      // both and the mounted component keeps its Model. Nothing is rebuilt.
      ToggledTheme: () => [{ ...model, theme: model.theme === "dark" ? "light" : "dark" }, []],
      // Reloading the catalog is reloading the page, because in the browser the
      // catalog *is* what the consumer's entry module imported. The address
      // carries the selection, so the reader comes back to the row they left.
      // Idempotent while it runs: a second click has nothing to start.
      ReloadedCatalog: () =>
        model.reloading
          ? [model, []]
          : [{ ...model, reloading: true }, [LeavePage({ href: urlToString(model.url) })]],
      // A verified paint, and its opposite. Neither is inferred from the record
      // — `hasMount: true` says a thunk exists, not that it drew anything.
      PreviewMounted: () => [{ ...model, mounted: true, previewFailed: false }, []],
      PreviewFailed: () => [{ ...model, mounted: false, previewFailed: true }, []],
      // The first row on an empty trail has nothing before it to be measured
      // against, so its gap is zero whatever the edge handed over.
      PreviewDispatched: ({ tag, delta }) => [
        {
          ...model,
          trail: Arr.append(model.trail, {
            tag,
            delta: model.trail.length === 0 ? 0 : delta,
          }),
        },
        [],
      ],
      ClearedHistory: () => [{ ...model, trail: [] }, []],
      // A new key for the preview slot, which destroys it, which runs the
      // teardown, which is what takes the component's Model back to `init`.
      Remounted: () => [{ ...model, remounts: model.remounts + 1, ...freshPreview }, []],
      ToggledComponent: ({ component }) => [
        {
          ...model,
          collapsedComponents: Arr.contains(model.collapsedComponents, component)
            ? Arr.filter(model.collapsedComponents, (name) => name !== component)
            : Arr.append(model.collapsedComponents, component),
        },
        [],
      ],
      TypedQuery: ({ query }) => [{ ...model, query }, []],
      RevealedSelection: () => [model, []],
      WroteAddress: () => [model, []],
      LeftForPage: () => [model, []],
    }),
  )
// VIEW

/**
 * The one stylesheet the lab carries, so it draws as a lab in a page that
 * styles nothing. Every rule is scoped to a `foldcase-lab-` name or class, and
 * every colour and both font stacks are custom properties on the root, so a
 * consumer restyles the whole surface by setting values rather than by
 * out-specifying a hundred rules.
 *
 * **The palette is the reader's, not the machine's.** Both schemes are declared
 * under `[data-theme]`, which the view always writes, so the toggle in the
 * header outranks `prefers-color-scheme` — a reader checking a light component
 * on a dark machine has to be able to say so. Dark is the default.
 *
 * **Three tokens depart from the design's table, and only these three.** The
 * table's `--ink-3` reads 3.5:1 on `--panel` in both schemes, and `--accent`,
 * `--pass` and `--fail` read near 4.1:1 on white — under the 4.5:1 floor this
 * codebase holds every piece of text to. `--ink-3` is darkened in light and
 * lightened in dark to the smallest value that clears the floor, and the three
 * status colours keep their table value for *fills* — dots, the tab underline,
 * the scrubber — while `--accent-text`, `--pass-text` and `--fail-text` carry
 * the same hue at a lightness that clears it for *text*. Splitting them is what
 * lets a 9px `LIVE` tag stay legible without dulling the dot beside it.
 *
 * **The frame is one viewport tall and each column scrolls itself.** It is
 * `fixed` rather than `100vh` because `100vh` still rides on whatever margin
 * the consumer's `body` carries, and a margin is exactly what the lab may not
 * reach out and change. Every scroll region has `min-height: 0` on its flex
 * parent, which is the single most common way to get this layout wrong.
 *
 * **No shadows anywhere.** Depth is `--panel` and `--sunken` against `--bg`,
 * plus hairlines. No border is wider than 1px except the 2px active tab rule.
 */
/**
 * The id on the lab's own stylesheet. It exists so that {@link adoptPageStyles}
 * can tell the shell's sheet from the consumer's and leave it where it is.
 */
const LAB_STYLE_ID = "foldcase-lab-style"

const STYLESHEET = `
#foldcase-lab {
  --ui: Outfit, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg: #1e1c21; --panel: #26242b; --sunken: #1a181d;
  --ink: #FAFAFA; --ink-2: #a7a3ae; --ink-3: #8f8b98;
  --line: #34313a; --sel: #332f3d; --sel-hover: #2c2a33; --sel-text: #413b54;
  --accent: oklch(0.76 0.11 285); --accent-text: oklch(0.76 0.11 285);
  --pass: oklch(0.76 0.13 155); --pass-text: oklch(0.76 0.13 155);
  --fail: oklch(0.71 0.16 25); --fail-text: oklch(0.75 0.15 25);
  --pass-bg: oklch(0.28 0.04 155); --fail-bg: oklch(0.29 0.05 25);
  --fail-line: oklch(0.40 0.08 25); --diff: oklch(0.76 0.11 235);
}
#foldcase-lab[data-theme='light'] {
  --bg: #f8f7fb; --panel: #ffffff; --sunken: #f2f1f6;
  --ink: #0B0C0E; --ink-2: #5c5a63; --ink-3: #6e6b75;
  --line: #e4e2ea; --sel: #ecebf3; --sel-hover: #f4f3f8; --sel-text: #e3e0f2;
  --accent: oklch(0.52 0.14 285); --accent-text: oklch(0.46 0.15 285);
  --pass: oklch(0.52 0.11 155); --pass-text: oklch(0.46 0.12 155);
  --fail: oklch(0.53 0.17 25); --fail-text: oklch(0.45 0.19 25);
  --pass-bg: oklch(0.96 0.03 155); --fail-bg: oklch(0.96 0.03 25);
  --fail-line: oklch(0.88 0.06 25); --diff: oklch(0.62 0.12 235);
}

#foldcase-lab { position: fixed; inset: 0; display: flex; flex-direction: column;
  box-sizing: border-box; background: var(--bg); color: var(--ink);
  font-family: var(--ui); font-size: 14px; line-height: 1.45;
  -webkit-font-smoothing: antialiased; }
#foldcase-lab *, #foldcase-lab *::before, #foldcase-lab *::after { box-sizing: border-box; }
/* Wrapped in :where() end to end, so the reset weighs nothing at all and every
   rule below — id or single class — outranks it. An unwrapped id-plus-type selector is
   worth more than a class, which is how a reset quietly eats the padding off
   the row it was meant to set up. */
:where(#foldcase-lab) :where(button) { font: inherit; color: inherit;
  background: none; border: 0; padding: 0; cursor: pointer; }
#foldcase-lab a { color: var(--accent-text); }
#foldcase-lab a:hover { color: var(--ink); text-decoration: underline; }
#foldcase-lab ::selection { background: var(--sel-text); }
#foldcase-lab :focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

@keyframes foldcase-lab-spin { to { transform: rotate(360deg); } }
@keyframes foldcase-lab-in { from { opacity: 0; } to { opacity: 1; } }

/* Read aloud, never drawn. The clip-rect idiom rather than display:none, which
   takes the element out of the accessibility tree along with the pixels. */
.foldcase-lab-sr { position: absolute; width: 1px; height: 1px; margin: -1px;
  padding: 0; border: 0; overflow: hidden; white-space: nowrap;
  clip-path: inset(50%); }

/* ── header, 52px ─────────────────────────────────────────────────────────── */
#foldcase-lab-bar { flex: none; height: 52px; display: flex; align-items: center;
  gap: 14px; padding: 0 14px; background: var(--panel);
  border-bottom: 1px solid var(--line); }
#foldcase-lab-brand { display: flex; align-items: center; gap: 9px; }
#foldcase-lab-brand svg { flex: none; color: var(--ink); }
#foldcase-lab-brand b { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
#foldcase-lab-bar .foldcase-lab-spacer { flex: 1; }
#foldcase-lab-runtime { flex: 0 1 auto; min-width: 0; padding: 4px 9px;
  border: 1px solid var(--line); border-radius: 5px; background: var(--sunken);
  font-family: var(--mono); font-size: 11.5px; line-height: normal;
  color: var(--ink-3); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
#foldcase-lab-runtime[data-state='live'] { color: var(--pass-text); }
#foldcase-lab-runtime[data-state='failed'] { color: var(--fail-text); }
#foldcase-lab-reload { flex: none; display: flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 6px;
  background: var(--ink); color: var(--bg); font-size: 12.5px; font-weight: 600; }
#foldcase-lab-reload:hover { opacity: 0.85; }
#foldcase-lab-reload i { display: none; flex: none; width: 11px; height: 11px;
  border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%;
  animation: foldcase-lab-spin 0.7s linear infinite; }
#foldcase-lab-reload[data-loading='true'] i { display: block; }
#foldcase-lab-theme { flex: none; display: flex; align-items: center;
  justify-content: center; width: 30px; height: 30px; border: 1px solid var(--line);
  border-radius: 6px; background: var(--panel); color: var(--ink-2); font-size: 13px; }
#foldcase-lab-theme:hover { color: var(--ink); border-color: var(--ink-3); }

#foldcase-lab-frame { flex: 1; min-height: 0; display: flex; }

/* ── sidebar, 292px ───────────────────────────────────────────────────────── */
#foldcase-lab-sidebar { flex: none; width: 292px; min-height: 0; display: flex;
  flex-direction: column; background: var(--panel);
  border-right: 1px solid var(--line); }
#foldcase-lab-sidebar-head { flex: none; padding: 10px;
  border-bottom: 1px solid var(--line); }
#foldcase-lab-search { display: block; width: 100%; height: 30px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--sunken);
  font: inherit; font-size: 12.5px; color: var(--ink); outline: none; }
#foldcase-lab-search::placeholder { color: var(--ink-3); }
/* The design asks for the border shift as this field's focus signal; the ring
   every other control gets stays on top of it, so a reader tabbing through does
   not meet one control that signals focus differently from the rest. */
#foldcase-lab-search:focus { border-color: var(--ink-3); }
#foldcase-lab-search:focus-visible { border-color: var(--ink-3);
  outline: 2px solid var(--accent); outline-offset: -2px; }
#foldcase-lab-summary { flex: none; display: flex; align-items: center; gap: 10px;
  margin: 0; padding: 9px 12px; border-bottom: 1px solid var(--line);
  font-family: var(--mono); font-size: 11px; line-height: normal; color: var(--ink-2);
  font-variant-numeric: tabular-nums; white-space: nowrap; }
#foldcase-lab-summary span:last-child { margin-left: auto; color: var(--ink-3); }
#foldcase-lab-tree { flex: 1; min-height: 0; overflow: auto;
  overscroll-behavior: contain; padding: 6px 0 16px; }
#foldcase-lab-tree ul { list-style: none; margin: 0; padding: 0; }
#foldcase-lab-foot { flex: none; margin: 0; padding: 9px 12px;
  border-top: 1px solid var(--line); font-family: var(--mono); font-size: 10.5px;
  line-height: 1.55; color: var(--ink-3); }

.foldcase-lab-component { display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 12px; text-align: left; font-size: 12.5px; line-height: normal;
  font-weight: 600; color: var(--ink); }
.foldcase-lab-component:hover { color: var(--accent-text); }
.foldcase-lab-component svg { flex: none; width: 8px; height: 8px; color: var(--ink-3);
  transform: rotate(-90deg); transition: transform 140ms ease-out; }
.foldcase-lab-component[aria-expanded='true'] svg { transform: none; }
.foldcase-lab-component em { flex: 1; min-width: 0; font-style: normal;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foldcase-lab-component i { flex: none; font-family: var(--mono); font-style: normal;
  font-size: 10px; font-weight: 400; color: var(--ink-3);
  font-variant-numeric: tabular-nums; }

.foldcase-lab-state { position: relative; display: flex; align-items: flex-start;
  gap: 9px; width: 100%; padding: 5px 12px 5px 28px; text-align: left;
  font-size: 12.5px; line-height: 1.35; color: var(--ink-2);
  transition: background-color 120ms ease-out, color 120ms ease-out; }
.foldcase-lab-state:hover { background: var(--sel-hover); }
.foldcase-lab-state[data-selected='true'],
.foldcase-lab-state[data-selected='true']:hover { background: var(--sel); color: var(--ink); }
/* The mark says "mountable here" and nothing else. It is never green and never
   red: the catalog carries no pass and no fail, so a status dot would be a
   claim the data cannot back. */
.foldcase-lab-state::before { content: ''; flex: none; width: 6px; height: 6px;
  margin-top: 5px; border-radius: 50%; background: var(--accent); }
.foldcase-lab-state[data-mountable='false']::before { background: none;
  border: 1px solid var(--ink-3); }
.foldcase-lab-state em { flex: 1; min-width: 0; font-style: normal;
  overflow-wrap: anywhere; }
.foldcase-lab-state i { flex: none; margin-top: 1px; font-family: var(--mono);
  font-style: normal; font-size: 9px; letter-spacing: 0.05em; color: var(--accent-text); }
/* The marker the reveal Mount is handed. Stretched over the row so that
   scrolling *it* into view scrolls the whole row in, margins and all. */
.foldcase-lab-reveal { position: absolute; inset: 0; pointer-events: none;
  scroll-margin: 20px 0; }

.foldcase-lab-failed { display: flex; align-items: flex-start; gap: 8px; margin: 0;
  padding: 6px 12px 6px 12px; color: var(--fail-text); font-size: 12px;
  line-height: 1.35; }
.foldcase-lab-failed i { flex: none; font-family: var(--mono); font-style: normal; }
.foldcase-lab-failed em { flex: 1; min-width: 0; font-style: normal;
  font-family: var(--mono); font-size: 11px; overflow-wrap: anywhere; }
.foldcase-lab-failed em small { display: block; font-size: 11px; color: var(--ink-2); }
#foldcase-lab-empty-tree { margin: 12px; font-size: 12.5px; color: var(--ink-2); }
#foldcase-lab-empty-tree b { display: block; color: var(--ink); }

/* ── main: tab bar 40px, body, drawer ─────────────────────────────────────── */
#foldcase-lab-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#foldcase-lab-tabs { flex: none; height: 40px; display: flex; align-items: stretch;
  gap: 0; padding: 0 12px; background: var(--panel);
  border-bottom: 1px solid var(--line); }
#foldcase-lab-tabs button[role='tab'] { padding: 0 12px; border-bottom: 2px solid transparent;
  font-size: 12.5px; font-weight: 500; color: var(--ink-3); }
#foldcase-lab-tabs button[role='tab']:hover { color: var(--ink); }
#foldcase-lab-tabs button[role='tab'][aria-selected='true'] { border-bottom-color: var(--ink);
  color: var(--ink); }
#foldcase-lab-tabs .foldcase-lab-spacer { flex: 1; }
#foldcase-lab-tabs button[role='tab'] { flex: none; }
#foldcase-lab-tab-file { align-self: center; min-width: 0; padding-left: 12px;
  font-family: var(--mono); font-size: 11px; line-height: normal;
  color: var(--ink-3); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
#foldcase-lab-body { flex: 1; min-height: 0; overflow: auto;
  overscroll-behavior: contain; display: flex; flex-direction: column;
  animation: foldcase-lab-in 0.18s ease; }

#foldcase-lab-notice { flex: none; margin: 12px 20px 0; padding: 10px 12px;
  border: 1px solid var(--fail-line); border-radius: 6px; background: var(--fail-bg);
  font-size: 12.5px; color: var(--ink); }
#foldcase-lab-notice code { font-family: var(--mono); }

/* ── the canvas tab ───────────────────────────────────────────────────────── */
#foldcase-lab-canvas { flex: 1 0 auto; min-height: 100%; display: flex;
  flex-direction: column; }
#foldcase-lab-canvas-bar { flex: none; display: flex; align-items: center; gap: 10px;
  padding: 9px 20px; background: var(--panel); border-bottom: 1px solid var(--line);
  font-family: var(--mono); font-size: 11px; line-height: normal; color: var(--ink-3); }
#foldcase-lab-canvas-bar .foldcase-lab-spacer { flex: 1; }
#foldcase-lab-remount { flex: none; height: 24px; padding: 0 9px;
  border: 1px solid var(--line); border-radius: 5px; background: var(--panel);
  color: var(--ink-2); font-size: 11px; }
#foldcase-lab-remount:hover { color: var(--ink); }
#foldcase-lab-canvas-body { flex: 1 0 auto; min-height: 280px; display: flex; }

#foldcase-lab-preview { flex: 1; min-width: 0; min-height: 280px; overflow: auto;
  padding: 24px; background: var(--sunken); display: flex; align-items: flex-start;
  justify-content: center; }
#foldcase-lab-card { width: 100%; max-width: 520px; margin: auto;
  border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
  overflow: hidden; }
#foldcase-lab-card-title { display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-bottom: 1px solid var(--line); font-family: var(--mono);
  font-size: 11px; line-height: normal; color: var(--ink-3); }
#foldcase-lab-card-title::before { content: ''; flex: none; width: 6px; height: 6px;
  border-radius: 50%; background: var(--ink-3); }
#foldcase-lab-card-title[data-live='true']::before { background: var(--pass); }
#foldcase-lab-card-title span { min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
#foldcase-lab-slot { height: 186px; overflow: auto; }
#foldcase-lab-slot[data-mountable='false'] { height: 0; }
#foldcase-lab-card-model { display: flex; gap: 10px; padding: 9px 12px;
  border-top: 1px solid var(--line); background: var(--sunken);
  font-family: var(--mono); font-size: 11.5px; line-height: normal; color: var(--ink-2); }
#foldcase-lab-card-model b { flex: none; font-weight: 400; color: var(--ink-3); }
#foldcase-lab-card-empty { padding: 40px 30px; text-align: center;
  font-family: var(--mono); font-size: 12px; line-height: 1.75; color: var(--ink-3);
  text-wrap: pretty; }

/* ── the timeline pane, 308px ─────────────────────────────────────────────── */
#foldcase-lab-trail { flex: none; width: 308px; min-height: 0; display: flex;
  flex-direction: column; background: var(--panel);
  border-left: 1px solid var(--line); }
#foldcase-lab-trail-head { flex: none; display: flex; align-items: center;
  justify-content: space-between; gap: 8px; padding: 6px 10px;
  border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 12px;
  line-height: normal; }
#foldcase-lab-trail-head b { display: flex; align-items: center; gap: 6px;
  font-weight: 400; color: var(--ink-3); }
#foldcase-lab-trail-head b::before { content: ''; flex: none; width: 6px; height: 6px;
  border-radius: 50%; background: var(--ink-3); }
#foldcase-lab-trail-head[data-live='true'] b { color: var(--pass-text); }
#foldcase-lab-trail-head[data-live='true'] b::before { background: var(--pass); }
#foldcase-lab-trail-clear { font-family: var(--mono); font-size: 12px;
  color: var(--ink-3); }
#foldcase-lab-trail-clear:hover { color: var(--ink); }
#foldcase-lab-trail-list { flex: 1; min-height: 0; overflow: auto; margin: 0;
  padding: 0; list-style: none; }
#foldcase-lab-trail-list li { display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-bottom: 1px solid var(--line); }
#foldcase-lab-trail-list b { flex: none; min-width: 20px; font-family: var(--mono);
  font-size: 10px; font-weight: 400; color: var(--ink-3);
  font-variant-numeric: tabular-nums; }
#foldcase-lab-trail-list li::after { content: ''; order: -1; }
.foldcase-lab-diff { flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: var(--diff); }
#foldcase-lab-trail-list em { flex: 1; min-width: 0; font-style: normal;
  font-family: var(--mono); font-size: 11.5px; color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#foldcase-lab-trail-list i { flex: none; font-family: var(--mono); font-style: normal;
  font-size: 10px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
#foldcase-lab-trail-empty { margin: 0; padding: 14px 12px; font-family: var(--mono);
  font-size: 11px; line-height: 1.75; color: var(--ink-3); }
#foldcase-lab-scrubber { flex: none; height: 33px; display: flex; align-items: center;
  border-top: 1px solid var(--line); }
#foldcase-lab-scrubber div { flex: 1; height: 16px; display: flex; align-items: center;
  padding: 0 7px; }
#foldcase-lab-scrubber div span { width: 100%; height: 4px; border-radius: 9999px;
  background: var(--line); }
#foldcase-lab-scrubber div span b { display: block; width: 0; height: 100%;
  border-radius: 9999px; background: var(--accent); }
#foldcase-lab-scrubber[data-filled='true'] div span b { width: 100%; }
#foldcase-lab-scrubber em { flex: none; width: 72px; padding-left: 12px;
  border-left: 1px solid var(--line); text-align: center; font-style: normal;
  font-family: var(--mono); font-size: 10px; color: var(--ink-3);
  font-variant-numeric: tabular-nums; }

/* ── the entry, timeline and schema tabs ──────────────────────────────────── */
.foldcase-lab-page { flex: none; }
#foldcase-lab-entry { padding: 26px 32px 34px; max-width: 900px; }
#foldcase-lab-timeline { padding: 26px 32px 34px; max-width: 860px; }
#foldcase-lab-schema { padding: 28px 32px 40px; max-width: 820px; }
.foldcase-lab-top { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.foldcase-lab-pill { flex: none; padding: 4px 10px; border-radius: 6px;
  background: var(--sunken); color: var(--ink-2); font-family: var(--mono);
  font-size: 11.5px; font-weight: 600; }
.foldcase-lab-top small { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
#foldcase-lab-entry h1 { margin: 0 0 20px; font-family: var(--mono); font-size: 22px;
  font-weight: 500; letter-spacing: -0.015em; word-break: break-word; }
/* The hairline trick: a 1px gap over a --line ground reads as one rule
   between cells, where a border on each cell would read as two. */
#foldcase-lab-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  margin: 0; border: 1px solid var(--line); border-radius: 9px; overflow: hidden;
  background: var(--line); }
#foldcase-lab-facts > div { padding: 11px 15px; background: var(--panel); }
#foldcase-lab-facts dt { margin: 0 0 4px; font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
#foldcase-lab-facts dd { margin: 0; font-family: var(--mono); font-size: 12.5px;
  word-break: break-word; color: var(--ink); }
#foldcase-lab-facts dd[data-value='true'] { color: var(--pass-text); }
#foldcase-lab-facts dd[data-value='false'] { color: var(--ink-3); }
#foldcase-lab-facts dd[data-field='file'] { color: var(--ink-2); }
.foldcase-lab-note { margin: 20px 0 0; padding: 14px 16px; border: 1px solid var(--line);
  border-radius: 9px; background: var(--panel); font-size: 12.5px; line-height: 1.65;
  color: var(--ink-2); text-wrap: pretty; }

#foldcase-lab-timeline > p { margin: 0 0 20px; font-size: 13px; line-height: 1.65;
  color: var(--ink-2); text-wrap: pretty; }
#foldcase-lab-timeline-empty { padding: 20px; border: 1px dashed var(--line);
  border-radius: 9px; font-family: var(--mono); font-size: 12px; line-height: 1.75;
  color: var(--ink-3); }
#foldcase-lab-timeline ol { margin: 0; padding: 0; list-style: none; }
#foldcase-lab-timeline li { display: grid; grid-template-columns: 18px 1fr; gap: 16px; }
.foldcase-lab-rail { display: flex; flex-direction: column; align-items: center; }
.foldcase-lab-rail::before { content: ''; flex: none; width: 9px; height: 9px;
  margin-top: 5px; border-radius: 50%; background: var(--accent); }
.foldcase-lab-rail::after { content: ''; flex: 1; width: 1px; background: var(--line); }
#foldcase-lab-timeline li > div:last-child { padding-bottom: 20px; }
#foldcase-lab-timeline b { display: block; margin-bottom: 4px; font-family: var(--mono);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; color: var(--accent-text); }
#foldcase-lab-timeline em { display: block; margin-bottom: 5px; font-style: normal;
  font-family: var(--mono); font-size: 13.5px; color: var(--ink); word-break: break-word; }
#foldcase-lab-timeline small { font-family: var(--mono); font-size: 12px;
  color: var(--ink-3); }

#foldcase-lab-schema .foldcase-lab-top { margin-bottom: 18px; }
#foldcase-lab-chip { flex: none; padding: 3px 8px; border: 1px solid var(--line);
  border-radius: 5px; background: var(--panel); font-family: var(--mono);
  font-size: 11px; color: var(--ink-2); }
#foldcase-lab-schema .foldcase-lab-top small { margin-left: auto; color: var(--fail-text); }
#foldcase-lab-schema h1 { margin: 0 0 12px; font-family: var(--mono); font-size: 20px;
  font-weight: 500; word-break: break-word; }
#foldcase-lab-warning { margin: 0 0 20px; padding: 15px 17px;
  border: 1px solid var(--fail-line); border-radius: 9px; background: var(--fail-bg);
  font-size: 12.5px; line-height: 1.7; color: var(--ink); text-wrap: pretty; }
.foldcase-lab-rows { display: flex; flex-direction: column; gap: 1px; margin: 0;
  border: 1px solid var(--line); border-radius: 9px; overflow: hidden;
  background: var(--line); }
.foldcase-lab-rows > div { display: grid; gap: 16px; padding: 11px 15px;
  background: var(--panel); font-family: var(--mono); font-size: 12px; }
#foldcase-lab-schema-facts > div { grid-template-columns: 230px 1fr; }
.foldcase-lab-rows dt { margin: 0; color: var(--ink-2); }
.foldcase-lab-rows dd { margin: 0; color: var(--ink-2); }
.foldcase-lab-rows dd[data-tone='pass'] { color: var(--pass-text); }
.foldcase-lab-rows dd[data-tone='fail'] { color: var(--fail-text); }

/* ── the addon drawer ─────────────────────────────────────────────────────── */
#foldcase-lab-drawer { flex: none; background: var(--panel);
  border-top: 1px solid var(--line); }
#foldcase-lab-drawer-tabs { height: 36px; display: flex; align-items: stretch;
  padding: 0 12px; border-bottom: 1px solid var(--line); }
#foldcase-lab-drawer-tabs button[role='tab'] { display: flex; align-items: center; gap: 6px;
  padding: 0 11px; border-bottom: 2px solid transparent; font-size: 12px;
  font-weight: 500; color: var(--ink-3); }
#foldcase-lab-drawer-tabs button[role='tab']:hover { color: var(--ink); }
#foldcase-lab-drawer-tabs button[role='tab'][aria-selected='true'] { border-bottom-color: var(--ink);
  color: var(--ink); }
#foldcase-lab-drawer-tabs .foldcase-lab-spacer { flex: 1; }
#foldcase-lab-drawer-tabs em { padding: 1px 5px; border-radius: 4px;
  background: var(--sunken); font-style: normal; font-family: var(--mono);
  font-size: 10px; font-weight: 500; line-height: normal; color: var(--ink-3); }
/* A warning, not a count: eight fields a catalog browser usually shows that
   this catalog does not carry. */
#foldcase-lab-drawer-tabs em[data-tone='fail'] { background: var(--fail-bg);
  color: var(--fail-text); }
#foldcase-lab-collapse { padding: 0 8px; font-size: 14px; color: var(--ink-3); }
#foldcase-lab-collapse:hover { color: var(--ink); }
#foldcase-lab-drawer-body { height: min(222px, 30vh); overflow: auto;
  overscroll-behavior: contain; padding: 16px 20px 22px; }
#foldcase-lab-drawer-body > p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.65;
  color: var(--ink-2); text-wrap: pretty; }
#foldcase-lab-drawer-body dl { display: grid; gap: 0; margin: 0; }
#foldcase-lab-drawer-body dl > div { display: grid; gap: 16px; padding: 8px 0;
  border-top: 1px solid var(--line); }
#foldcase-lab-drawer-body dt { margin: 0; font-family: var(--mono); font-size: 12px;
  color: var(--ink); overflow-wrap: anywhere; }
#foldcase-lab-drawer-body dt[data-tone='pass'] { color: var(--pass-text); }
#foldcase-lab-drawer-body dt[data-tone='fail'] { color: var(--fail-text); }
#foldcase-lab-drawer-body dt[data-tone='mute'] { color: var(--ink-2); }
#foldcase-lab-drawer-body dd { margin: 0; font-size: 12.5px; line-height: 1.5;
  color: var(--ink-2); text-wrap: pretty; }
#foldcase-lab-drawer-body dd code { font-family: var(--mono); }
#foldcase-lab-panel-runtime dl > div { grid-template-columns: 220px 1fr; }
#foldcase-lab-panel-absent dl > div { grid-template-columns: 200px 1fr; }
#foldcase-lab-panel-agent dl > div { grid-template-columns: 280px 1fr; }
#foldcase-lab-panel-json { margin: 0; font-family: var(--mono); font-size: 12px;
  line-height: 1.7; color: var(--ink-2); white-space: pre-wrap;
  overflow-wrap: anywhere; }

/* Under about a phone's width the header has more controls than room. The
   pill is the only thing on it that is a reading rather than a control, and the
   canvas toolbar and the trail header both carry the same state — so it is the
   one that goes, and every control stays reachable. */
@media (max-width: 560px) {
  #foldcase-lab-runtime { display: none; }
  #foldcase-lab-bar { gap: 10px; }
  #foldcase-lab-tab-file { display: none; }
}
@media (max-width: 880px) {
  #foldcase-lab-frame { flex-direction: column; }
  #foldcase-lab-sidebar { flex: 0 0 34%; width: auto; border-right: 0;
    border-bottom: 1px solid var(--line); }
  #foldcase-lab-canvas-body { flex-direction: column; }
  #foldcase-lab-trail { width: auto; border-left: 0; border-top: 1px solid var(--line); }
  #foldcase-lab-entry, #foldcase-lab-timeline, #foldcase-lab-schema { padding: 20px 16px 28px; }
  #foldcase-lab-facts { grid-template-columns: 1fr; }
  #foldcase-lab-drawer-body dl > div { grid-template-columns: 1fr; gap: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  #foldcase-lab * { transition-duration: 1ms !important; animation: none !important; }
}
`

/** The part of an id that is not its component namespace. */
const leafOf = (id: string): string => id.slice(id.lastIndexOf("/") + 1)

/** A count, zero-padded to three, which is how the trail keeps its columns straight. */
const padded = (count: number): string => String(count).padStart(3, "0")

/**
 * Bring the chosen row into view, and nothing else.
 *
 * A cold load of `?showcase=<id>` selects a row that can be thousands of pixels
 * down a sidebar that scrolls itself, and a selection nobody can see is a panel
 * with no answer to "where did this come from". The lab may not go looking for
 * that row in the document — a surface that queries the DOM is the move
 * ADR-0001 exists to stop — and it does not have to: `OnMount` hands the
 * factory the live element. It is handed a marker that exists only inside the
 * chosen row, so every new selection builds one and this runs once for it,
 * while the row around it — and any focus on it — survives untouched.
 */
const RevealSelection = Mount.define("RevealSelection", { id: Schema.String }, RevealedSelection)(
  ({ id }) =>
    (element) =>
      Effect.sync(() => {
        element.scrollIntoView({ block: "nearest" })
        return RevealedSelection({ id })
      }),
)

/** The id of the row a Showcase is drawn on. */
const rowIdOf = (id: string): string => `foldcase-lab-select-${id}`

/**
 * The selector that finds that row again, for the one caller that has to: the
 * arrow keys, which move DOM focus to the row they land on.
 *
 * It matches on `data-id` and not on the element's id, because a Showcase id
 * holds slashes and a slash in a CSS id selector is a syntax error, not a
 * slash. An attribute value takes it verbatim; the only thing to escape is a
 * quote, which no catalog has yet put in an id and which would break the
 * selector silently if one ever did.
 */
const rowSelectorOf = (id: string): string =>
  `#foldcase-lab-tree button[data-id="${id.replace(/["\\]/g, "\\$&")}"]`

/**
 * The disclosure mark on a component heading, drawn rather than typed.
 *
 * The design names the literal characters `▾` and `▸` and then says to swap
 * them for the codebase's icon set. This is that set. Two characters standing
 * in for an icon inherit the text's weight, sit on the baseline rather than on
 * the row's centre, and are read out loud as part of the component's name; one
 * path at one stroke width is none of those things, and `aria-hidden` keeps it
 * out of the accessible name where `aria-expanded` says the same thing
 * properly.
 */
const caretMark = (h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox("0 0 12 12"),
      h.Width("12"),
      h.Height("12"),
      h.Fill("none"),
      h.Stroke("currentColor"),
      h.StrokeWidth("1.8"),
      h.StrokeLinecap("round"),
      h.StrokeLinejoin("round"),
      h.AriaHidden(true),
    ],
    [h.path([h.D("M3 4.5 6 7.5 9 4.5")], [])],
  )

/**
 * The mark on the bar, and the only picture the lab draws.
 *
 * It is markup rather than a file because the lab ships as compiled TypeScript
 * and nothing else — there is no asset in the tarball for a stylesheet to point
 * `url()` at, so the design's `mask: url(mark.svg)` has nothing to point at
 * either. `fill: currentColor` does the same job: the ink follows the theme.
 */
const brandMark = (h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox("0 0 256 256"),
      h.Width("22"),
      h.Height("22"),
      h.Fill("currentColor"),
      h.AriaHidden(true),
    ],
    [
      h.path(
        [
          h.FillRule("evenodd"),
          h.D("M128 16 224 72V184L128 240 32 184V72Z M128 44 200 86V170L128 212 56 170V86Z"),
        ],
        [],
      ),
      h.path([h.D("M136 124 136 68 184 96 184 152Z")], []),
      h.path([h.D("M128 138 176 166 128 194 80 166Z")], []),
      h.path([h.D("M120 124 72 152 72 96 120 68Z")], []),
    ],
  )

/**
 * What the pill says about the runtime, and it says only what has been seen.
 *
 * The design's copy names a version and a CDN. Neither is knowable here: the
 * lab is bundled with the consumer's own Foldkit by the consumer's own dev
 * server (ADR-0004), so it can read neither the version nor where it came from.
 * What it can say is whether a mount has been watched to paint, which is the
 * fact the pill was carrying anyway.
 */
const runtimeState = (model: Model): readonly [string, string] =>
  model.previewFailed
    ? ["failed", "foldkit · mount painted nothing"]
    : model.mounted
      ? ["live", "foldkit · mounted"]
      : ["idle", "foldkit · nothing mounted"]

/**
 * The bar across the top, which is the lab saying whose lab it is.
 *
 * It spans both columns on purpose: the catalog and the stage are two halves of
 * one instrument, and a rule across the top of both is what says so. Nothing
 * stands beside the wordmark — no directory chip, no segmented toggle — because
 * both were tried, read as chrome, and taken out.
 */
const titleBar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const [state, pill] = runtimeState(model)
  return h.header(
    [h.Id("foldcase-lab-bar")],
    [
      h.div([h.Id("foldcase-lab-brand")], [brandMark(h), h.b([], ["Foldcase"])]),
      h.span([h.Class("foldcase-lab-spacer")], []),
      h.span([h.Id("foldcase-lab-runtime"), h.DataAttribute("state", state)], [pill]),
      h.button(
        [
          h.Type("button"),
          h.Id("foldcase-lab-reload"),
          h.DataAttribute("loading", String(model.reloading)),
          h.OnClick(ReloadedCatalog()),
        ],
        // Idle, the spinner is `display: none` rather than absent, so starting
        // a reload never reflows the button it sits in.
        [h.i([h.AriaHidden(true)], []), model.reloading ? "Loading" : "Reload catalog"],
      ),
      h.button(
        [
          h.Type("button"),
          h.Id("foldcase-lab-theme"),
          h.Title("Toggle theme"),
          h.AriaLabel(model.theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"),
          h.OnClick(ToggledTheme()),
        ],
        [h.span([h.AriaHidden(true)], [model.theme === "dark" ? "\u263E" : "\u2600"])],
      ),
    ],
  )
}

/**
 * One Showcase's row.
 *
 * The mark on the left says whether the canvas can mount this entry, and it
 * says nothing else. It is filled for a mountable entry and a hollow ring for
 * one with no mount — never green, never red. The catalog carries no pass and
 * no fail, so a status dot here would be a claim the data cannot back.
 */
const stateRow = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html => {
  const selected = isSelected(model, entry.id)
  return h.keyed("li")(
    // The key is the id and nothing else, so a row survives being chosen: the
    // arrow keys focus the row they are about to select, and an element rebuilt
    // under that focus would drop it on the floor and end the walk after one
    // step. What is rebuilt is the marker inside it — see below.
    entry.id,
    [],
    [
      h.button(
        [
          h.Type("button"),
          h.Class("foldcase-lab-state"),
          h.Id(rowIdOf(entry.id)),
          h.OnClick(SelectedShowcase({ id: entry.id })),
          h.DataAttribute("id", entry.id),
          h.DataAttribute("selected", String(selected)),
          h.DataAttribute("mountable", String(entry.hasMount)),
          // The roving tabindex: one row of however many is in the tab order,
          // and it is the chosen one. Without it a reader reaching the canvas
          // by keyboard passes through every row in the catalog first — a
          // hundred and seventy presses in the gallery this was measured on.
          h.Tabindex(selected ? 0 : -1),
          ...(selected ? [h.AriaCurrent("true")] : []),
        ],
        [
          h.em([], [leafOf(entry.id)]),
          ...(entry.hasMount ? [h.i([], ["LIVE"])] : []),
          // The marker that carries the reveal. It exists only while this row
          // is the chosen one, so it is built the moment the row is chosen and
          // that is what fires the Mount — without rebuilding the row itself.
          ...(selected
            ? [
                h.keyed("span")(
                  "reveal",
                  [
                    h.Class("foldcase-lab-reveal"),
                    h.AriaHidden(true),
                    h.OnMount(RevealSelection({ id: entry.id })),
                  ],
                  [],
                ),
              ]
            : []),
        ],
      ),
    ],
  )
}

/**
 * One component's group: a heading that folds it, and its states when it is
 * open.
 *
 * Two tiers and no file tier. A hundred and forty-six entries across
 * twenty-four files make the path noise on every row, and the file is on the
 * entry — the tab bar names it for whatever is selected. Folded, a group costs
 * one row instead of however many Showcases it declares, which is how
 * twenty-four components fit on one screen.
 */
const componentSection = (
  component: LabComponent,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const expanded = isComponentExpanded(model, component.component)
  const bodyId = `foldcase-lab-group-${component.component}`
  return h.section(
    [
      h.DataAttribute("component", component.component),
      h.DataAttribute("expanded", String(expanded)),
    ],
    [
      h.h3(
        [h.Class("foldcase-lab-sr")],
        [component.component],
      ),
      h.button(
        [
          h.Type("button"),
          h.Class("foldcase-lab-component"),
          h.OnClick(ToggledComponent({ component: component.component })),
          h.AriaExpanded(expanded),
          ...(expanded ? [h.AriaControls(bodyId)] : []),
        ],
        [
          caretMark(h),
          h.em([], [component.component]),
          h.i([], [String(component.entries.length)]),
        ],
      ),
      ...(expanded
        ? [
            h.ul(
              [h.Id(bodyId)],
              Arr.map(component.entries, (entry) => stateRow(entry, model, h)),
            ),
          ]
        : []),
    ],
  )
}

/**
 * The one row a file the loader could not read gets (ADR-0001 › Amendment 2).
 *
 * Such a file declared no id, so it has no component to hang under and no entry
 * to be found by — and it is still the answer to "where did that component go".
 * It sits at the top of the tree, in path order, because a reader looking for a
 * missing component looks at the list before they look anywhere else.
 */
const failureRow = (
  failure: LabCatalog["failures"][number],
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class("foldcase-lab-failed"), h.DataAttribute("failed", failure.path)],
    [
      h.i([h.AriaHidden(true)], ["✗"]),
      h.em([], [failure.path, h.small([], ["did not load — ", failure.reason])]),
    ],
  )

/**
 * What the strip says the catalog is: how many entries it holds, or — once a
 * filter is live — how many of them are left. A reader who narrowed a hundred
 * and forty-six down to three has to read that it was three of a hundred and
 * forty-six, or a short list is indistinguishable from a short catalog.
 */
const catalogCount = (model: Model): string => {
  const matching = matchingTotal(model)
  const showcases = `${model.catalog.total} showcases`
  return matching === model.catalog.total ? showcases : `${matching} of ${showcases}`
}

/** How many components hold what is drawn, counted rather than pluralised badly. */
const componentCount = (drawn: number): string =>
  drawn === 1 ? "1 component" : `${drawn} components`

/**
 * The catalog, and the one control over it.
 *
 * The head, the strip and the footer do not scroll and the tree does, which is
 * what keeps the filter on screen when the thing it filters is several thousand
 * pixels long.
 */
const sidebar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const components = sidebarComponents(model)
  const failures = sidebarFailures(model)
  return h.nav(
    [
      h.Id("foldcase-lab-sidebar"),
      h.AriaLabel("Showcases"),
      // The arrow keys live on the whole sidebar and not on the tree inside it,
      // so the filter and the rows are one keyboard surface: type to narrow,
      // then walk what is left without reaching for the mouse to get out of the
      // field. `OnKeyDownFocus` moves DOM focus to the row the step lands on at
      // the same time as it dispatches, which is what makes the roving tabindex
      // a navigation rather than a trap. Keys it does not handle are left
      // alone, so typing in the filter still types.
      h.OnKeyDownFocus((key) =>
        pipe(
          key === "ArrowDown" ? Option.some(1) : key === "ArrowUp" ? Option.some(-1) : Option.none(),
          Option.flatMap((delta) =>
            Option.map(neighbourId(model, delta), (id) => ({
              focusSelector: rowSelectorOf(id),
              message: MovedSelection({ delta }),
            })),
          ),
        ),
      ),
    ],
    [
      h.h2([h.Class("foldcase-lab-sr")], ["Showcases"]),
      h.div(
        [h.Id("foldcase-lab-sidebar-head")],
        [
          h.input([
            h.Id("foldcase-lab-search"),
            h.Type("search"),
            h.Value(model.query),
            h.Placeholder("Find a showcase"),
            h.AriaLabel("Filter showcases by id"),
            h.Autocomplete("off"),
            h.Spellcheck(false),
            h.OnInput((query) => TypedQuery({ query })),
          ]),
        ],
      ),
      h.p(
        [h.Id("foldcase-lab-summary")],
        [h.span([], [catalogCount(model)]), h.span([], [componentCount(components.length)])],
      ),
      h.div(
        [h.Id("foldcase-lab-tree")],
        components.length === 0 && failures.length === 0
          ? [
              h.p(
                [h.Id("foldcase-lab-empty-tree")],
                [
                  h.b([], ["Nothing matched"]),
                  h.span(
                    [],
                    [
                      "No id holds “",
                      model.query.trim(),
                      `”. Clear the filter to see all ${model.catalog.total} again.`,
                    ],
                  ),
                ],
              ),
            ]
          : [
              ...Arr.map(failures, (failure) => failureRow(failure, h)),
              ...Arr.map(components, (component) => componentSection(component, model, h)),
            ],
      ),
      h.p([h.Id("foldcase-lab-foot")], ["foldcase_load_catalog · no run yet, so no status"]),
    ],
  )
}

/** One cell of the Entry tab's facts grid. */
const fact = (
  label: string,
  value: string,
  tone: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [],
    [h.dt([], [label]), h.dd([h.DataAttribute("value", tone), h.DataAttribute("field", label)], [value])],
  )

/**
 * The Entry tab: the whole listing entry, said plainly.
 *
 * Six fields, and the closing note says they are six — because a reader who has
 * used a component browser before is looking for a seventh, and the honest
 * answer is that running the Showcase is the only way to get one.
 */
const entryTab = (entry: LabEntry, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Id("foldcase-lab-entry"), h.Class("foldcase-lab-page")],
    [
      h.div(
        [h.Class("foldcase-lab-top")],
        [
          h.span([h.Class("foldcase-lab-pill")], ["listed"]),
          h.small([], ["foldcase_list_showcases — the catalog reports no status until a run"]),
        ],
      ),
      h.h1([], [entry.id]),
      h.dl(
        [h.Id("foldcase-lab-facts")],
        [
          fact("component", entry.component, "text", h),
          fact("state", leafOf(entry.id), "text", h),
          fact("file", entry.file ?? "held in memory", "text", h),
          fact("hasMount", String(entry.hasMount), String(entry.hasMount), h),
          fact("hasMessageSchema", String(entry.hasMessageSchema), String(entry.hasMessageSchema), h),
          fact("hasModelSchema", String(entry.hasModelSchema), String(entry.hasModelSchema), h),
        ],
      ),
      h.p(
        [h.Class("foldcase-lab-note")],
        [
          "These six fields are the whole listing entry. Anything else a catalog browser might show — pass or fail, how long it took, which Messages the play dispatched — is not in the data, and is reachable only by running the Showcase.",
        ],
      ),
    ],
  )

/**
 * The Timeline tab: what a run would record, and why the listing holds none of
 * it.
 *
 * The trail fills only from Messages a mount relays out. Foldkit gives a host
 * no read on a runtime it did not build, so for a catalog whose `mount` is an
 * opaque thunk this stays at its empty state — which is the honest reading and
 * not a gap in the lab.
 */
const timelineTab = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Id("foldcase-lab-timeline"), h.Class("foldcase-lab-page")],
    [
      h.p(
        [],
        [
          "A play is an opaque thunk — the runner never looks inside it, and the catalog listing carries no trace of one. What can be recorded is a live mount. Foldkit gives a host no read on a runtime it did not build, so the trail is the mount's to fill: post { foldcase: \"dispatch\", tag } to the window as each Message reaches update, and the gap between them is measured here.",
        ],
      ),
      ...(model.trail.length === 0
        ? [
            h.p(
              [h.Id("foldcase-lab-timeline-empty")],
              [
                model.mounted
                  ? "Nothing relayed yet. Foldkit gives a host no read on a runtime it did not build, so a mount puts a Message here by posting { foldcase: \"dispatch\", tag } to the window."
                  : "The trail records real dispatches, so it fills only while a component is mounted.",
              ],
            ),
          ]
        : [
            h.ol(
              [],
              Arr.map(model.trail, (row, at) =>
                h.li(
                  [],
                  [
                    h.div([h.Class("foldcase-lab-rail"), h.AriaHidden(true)], []),
                    h.div(
                      [],
                      [
                        h.b([], ["message"]),
                        h.em([], [row.tag]),
                        h.small([], [`${padded(at + 1)} · +${row.delta}ms`]),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ]),
    ],
  )

/** One row of the Schema tab's facts list, or of a drawer panel. */
const row = (
  label: string,
  value: string,
  tone: string,
  h: HtmlBuilder<Message>,
): Html => h.div([], [h.dt([], [label]), h.dd([h.DataAttribute("tone", tone)], [value])])

/**
 * The Schema tab: the one-union problem, stated rather than papered over.
 *
 * A Foldkit catalog declares one Message union for the whole application, and
 * the MCP server hands back the same document whichever component is asked
 * about — twenty-four calls, twenty-four identical replies. A per-component
 * table would therefore be the same table once per component, which is worse
 * than no table because it looks like twenty-four answers.
 *
 * The numbers here are the catalog's own, counted from the listing. The design
 * cites the gallery's `45,759 bytes`; that is a measurement of one catalog and
 * would be a lie in front of another, so this counts what is in front of it.
 */
const schemaTab = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html => {
  const withMessage = Arr.filter(
    model.catalog.components.flatMap((component) => component.entries),
    (held) => held.hasMessageSchema,
  ).length
  const withModel = Arr.filter(
    model.catalog.components.flatMap((component) => component.entries),
    (held) => held.hasModelSchema,
  ).length
  const components = model.catalog.components.length
  return h.div(
    [h.Id("foldcase-lab-schema"), h.Class("foldcase-lab-page")],
    [
      h.div(
        [h.Class("foldcase-lab-top")],
        [
          h.span([h.Id("foldcase-lab-chip")], ["foldcase_get_showcase_schema"]),
          h.small([], ["catalog-wide, not per component"]),
        ],
      ),
      h.h1([], [entry.component]),
      h.p(
        [h.Id("foldcase-lab-warning")],
        [
          `One Message union covers the whole catalog. Asking about ${entry.component} and asking about any other component returns the same document, so a per-component table would be the same table ${components} times over. Until a catalog splits its unions, this tab is honest only as a catalog-wide view.`,
        ],
      ),
      h.dl(
        [h.Id("foldcase-lab-schema-facts"), h.Class("foldcase-lab-rows")],
        [
          row("hasMessageSchema", String(entry.hasMessageSchema), entry.hasMessageSchema ? "pass" : "mute", h),
          row("hasModelSchema", String(entry.hasModelSchema), entry.hasModelSchema ? "pass" : "mute", h),
          row("distinct documents", `1 across ${components} components`, "fail", h),
          row(
            "declaring a Message Schema",
            `${withMessage} of ${model.catalog.total} entries`,
            "mute",
            h,
          ),
          row("declaring a Model Schema", `${withModel} of ${model.catalog.total} entries`, "mute", h),
        ],
      ),
    ],
  )
}

/**
 * The four runtime facts this surface was built around, plus what the lab has
 * actually seen. Every one of them changed what is buildable here, which is why
 * they are in the UI rather than in a comment nobody opens.
 */
const RUNTIME_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "no Style attribute",
    "fail",
    "The builder offers Class, Id, Key, Title and every On* handler. A style string crashes the application, so every value on this screen is a class or a rule in one stylesheet.",
  ],
  [
    "the container is owned",
    "mute",
    "makeApplication replaces the node it is given, so a mount gets a fresh child element of its own and never the canvas itself.",
  ],
  [
    "update is async",
    "mute",
    "It runs on an Effect fiber, so the Model lands a tick after the event rather than during it.",
  ],
  [
    "the preview is isolated",
    "mute",
    "The shell re-renders on every dispatch, which would wipe an in-tree mount — and a mounted component's stylesheet must not reach the shell. The mount gets a shadow root, which answers both.",
  ],
  [
    "a paint is verified",
    "pass",
    "Runtime.run returns undefined and throws nothing when an application paints nothing at all, so Live is set from a checked container and never from a module that loaded.",
  ],
  [
    "foldkit is the consumer's",
    "mute",
    "The lab is compiled by tsc and bundled by the consumer's own dev server, so it reads neither the Foldkit version nor where it was resolved from.",
  ],
]

/**
 * The eight fields the first draft of this design leaned on, and what the
 * listing carries instead.
 *
 * They are in the UI on purpose. A catalog browser that quietly omits a status
 * column reads as a catalog with nothing to report; one that draws a grey dot
 * reads as a status. Naming the absence is the only reading that is true.
 */
const ABSENT_ROWS: ReadonlyArray<readonly [string, string]> = [
  [
    "status",
    "The listing carries none. Pass and fail belong to a run, not to a catalog — so there are no status dots in the tree.",
  ],
  [
    "error",
    "A file that would not load is a row in the tree. Anything else that failed belongs to a run report, which this surface does not hold.",
  ],
  [
    "kind",
    "No field, and no Scene in any catalog measured. A Story / Scene badge would say the same word on every row.",
  ],
  [
    "dispatches",
    "Not on the listing. A gap list held against the Message union would be empty by default, which reads as covered when it means unknown.",
  ],
  ["duration", "Not a field on ShowcaseReport."],
  ["lines / functions", "Coverage is collected by a run, and the listing carries no run."],
  [
    "exports a view",
    "No such field. hasMount is the closest, and it says a thunk exists rather than that a view does.",
  ],
  [
    "per-component schema",
    "One Message union covers the whole catalog, so every component returns the same document.",
  ],
]

/**
 * The same catalog over stdio. The copy is the tool descriptions themselves, so
 * a reader looking at the lab and an agent reading `tools/list` are told the
 * same thing.
 */
const TOOL_ROWS: ReadonlyArray<readonly [string, string]> = [
  [
    "foldcase_list_showcases",
    "Enumerate every Showcase — the file it came from, and whether it carries a mount, a Message Schema and a Model Schema.",
  ],
  [
    "foldcase_get_showcase_schema",
    "Introspect the Message union into a JSON Schema document, so a payload is built by construction.",
  ],
  ["foldcase_get_showcase_model_schema", "The same for the Model — the shape a play asserts on."],
  [
    "foldcase_run_showcase",
    "Run one play in a fresh subprocess, from the code on disk, and return the typed pass/fail report.",
  ],
  ["foldcase_run_catalog", "Run the whole catalog into one suite report, or the part under an id prefix."],
  [
    "foldcase_load_catalog",
    "Refresh the listing after files appear or vanish, or point the server at another directory under the root.",
  ],
]

/** A drawer panel: an intro, then a list of label/value rows. */
const panelOf = (
  id: string,
  intro: string,
  rows: ReadonlyArray<readonly [string, string, string]>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Id(id)],
    [
      h.p([], [intro]),
      h.dl(
        [],
        Arr.map(rows, ([label, tone, value]) =>
          h.div([], [h.dt([h.DataAttribute("tone", tone)], [label]), h.dd([], [value])]),
        ),
      ),
    ],
  )

/** The selected entry exactly as the listing carries it, and the catalog totals. */
const jsonPanel = (entry: Option.Option<LabEntry>, model: Model, h: HtmlBuilder<Message>): Html =>
  h.pre(
    [h.Id("foldcase-lab-panel-json")],
    [
      pipe(
        entry,
        Option.match({
          onNone: () => "// nothing selected",
          onSome: (held) =>
            JSON.stringify(
              {
                id: held.id,
                component: held.component,
                file: held.file,
                hasMount: held.hasMount,
                hasMessageSchema: held.hasMessageSchema,
                hasModelSchema: held.hasModelSchema,
              },
              null,
              2,
            ),
        }),
      ),
      `\n\n// catalog: { total: ${model.catalog.total}, components: ${model.catalog.components.length}, failures: ${model.catalog.failures.length} }`,
    ],
  )

/** One tab of the drawer strip, with its badge when it carries one. */
const drawerTab = (
  panel: Panel,
  label: string,
  badge: Option.Option<readonly [string, string]>,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type("button"),
      h.Role("tab"),
      h.AriaSelected(model.panel === panel && model.drawerOpen),
      h.DataAttribute("panel", panel),
      h.OnClick(SelectedPanel({ panel })),
    ],
    [
      label,
      ...pipe(
        badge,
        Option.match({
          onNone: (): ReadonlyArray<Html> => [],
          onSome: ([count, tone]) => [h.em([h.DataAttribute("tone", tone)], [count])],
        }),
      ),
    ],
  )

/**
 * The addon drawer, pinned to the bottom of main.
 *
 * Collapsing hides the body and keeps the strip, so the tabs stay reachable —
 * and the body is `min(222px, 30vh)` so that on a short viewport the drawer
 * yields rather than starving the canvas it sits under.
 */
const drawer = (
  entry: Option.Option<LabEntry>,
  model: Model,
  showAgentPanel: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.Id("foldcase-lab-drawer"), h.AriaLabel("Addons")],
    [
      h.div(
        [h.Id("foldcase-lab-drawer-tabs"), h.Role("tablist")],
        [
          drawerTab("runtime", "Runtime", Option.none(), model, h),
          drawerTab(
            "absent",
            "Not in the data",
            Option.some([String(ABSENT_ROWS.length), "fail"] as const),
            model,
            h,
          ),
          ...(showAgentPanel
            ? [
                drawerTab(
                  "agent",
                  "Agent (MCP)",
                  Option.some([String(TOOL_ROWS.length), "mute"] as const),
                  model,
                  h,
                ),
              ]
            : []),
          drawerTab("json", "JSON", Option.none(), model, h),
          h.span([h.Class("foldcase-lab-spacer")], []),
          h.button(
            [
              h.Type("button"),
              h.Id("foldcase-lab-collapse"),
              h.AriaExpanded(model.drawerOpen),
              h.AriaLabel(model.drawerOpen ? "Collapse the drawer" : "Open the drawer"),
              h.OnClick(ToggledDrawer()),
            ],
            [h.span([h.AriaHidden(true)], [model.drawerOpen ? "⌄" : "⌃"])],
          ),
        ],
      ),
      ...(model.drawerOpen
        ? [
            h.div(
              [h.Id("foldcase-lab-drawer-body")],
              [
                pipe(
                  M.value(model.panel),
                  M.withReturnType<Html>(),
                  M.when("runtime", () =>
                    panelOf(
                      "foldcase-lab-panel-runtime",
                      "Four facts about running Foldkit in a browser, each of which changed what this screen could be, and what the lab has seen since.",
                      RUNTIME_ROWS,
                      h,
                    ),
                  ),
                  M.when("absent", () =>
                    panelOf(
                      "foldcase-lab-panel-absent",
                      "Every row is a field a catalog browser usually shows, and what a Foldcase listing carries instead. None of them is drawn as a placeholder, because a placeholder reads as a value.",
                      Arr.map(ABSENT_ROWS, ([label, value]) => [label, "text", value] as const),
                      h,
                    ),
                  ),
                  M.when("agent", () =>
                    panelOf(
                      "foldcase-lab-panel-agent",
                      "The same catalog over stdio. All six tools are readOnlyHint: true, so a host does not prompt to list a catalog.",
                      Arr.map(TOOL_ROWS, ([label, value]) => [label, "text", value] as const),
                      h,
                    ),
                  ),
                  M.when("json", () => jsonPanel(entry, model, h)),
                  M.exhaustive,
                ),
              ],
            ),
          ]
        : []),
    ],
  )

/** One tab of the canvas tab bar. */
const canvasTab = (tab: Tab, label: string, model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type("button"),
      h.Role("tab"),
      h.AriaSelected(model.tab === tab),
      h.DataAttribute("tab", tab),
      h.OnClick(SelectedTab({ tab })),
    ],
    [label],
  )

/**
 * The tab bar, and the file the selection came from.
 *
 * The path is relative to the catalog root, because in a real catalog the first
 * forty characters are the same on every row and the part that differs is the
 * part that says anything. It is text and not a control: it is where the record
 * was declared, not a fact the record asserts.
 */
const tabBar = (entry: Option.Option<LabEntry>, model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Id("foldcase-lab-tabs"), h.Role("tablist")],
    [
      canvasTab("canvas", "Canvas", model, h),
      canvasTab("entry", "Entry", model, h),
      canvasTab("timeline", "Timeline", model, h),
      canvasTab("schema", "Schema", model, h),
      h.span([h.Class("foldcase-lab-spacer")], []),
      ...pipe(
        entry,
        Option.flatMap((held) => Option.fromUndefinedOr(held.file)),
        Option.match({
          onNone: (): ReadonlyArray<Html> => [],
          onSome: (file) => [
            h.span(
              [h.Id("foldcase-lab-tab-file"), h.Title(file)],
              [relativeFile(catalogRoot(model.catalog), file)],
            ),
          ],
        }),
      ),
    ],
  )

/**
 * The address named an id this catalog does not declare, said plainly.
 *
 * The lab falls back to the entry it was on, so there is always something
 * drawn — and this is why the drawn thing is not the one that was asked for. An
 * agent that built an address from a stale or guessed id reads its mistake here
 * instead of screenshotting the wrong component and believing it.
 */
const unknownIdNotice = (
  maybeUnknownId: Model["maybeUnknownId"],
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  pipe(
    maybeUnknownId,
    Option.match({
      onNone: (): ReadonlyArray<Html> => [],
      onSome: (id) => [
        h.p(
          [
            h.Id("foldcase-lab-notice"),
            h.DataAttribute("unknown-id", id),
            // Announced, because this is the one panel whose whole job is to
            // stop a reader believing what is drawn — and an agent driving the
            // lab by dispatch never looks at the colour.
            h.Role("status"),
          ],
          [
            "The id ",
            h.code([], [id]),
            " is not one this catalog declares. What is drawn below is a fallback.",
          ],
        ),
      ],
    }),
  )

/**
 * The page's own stylesheets, copied into the preview's shadow root.
 *
 * A shadow root stops styles in both directions, and only one of those
 * directions is wanted.
 *
 * Out is the direction the root exists for: a mounted component must not be
 * able to restyle the shell around it, and a Showcase shipping
 * `body { background: red }` must leave the lab exactly as it found it.
 *
 * In is the opposite case, and cutting it costs the whole point of the canvas.
 * A component *is* its consumer's design system — a Foldkit gallery styles its
 * buttons from a stylesheet the page links, not from rules it carries itself —
 * so a mount sealed off from that sheet draws browser defaults, which is not
 * the component anybody wrote. Copying the sheets in gives the mount the page
 * it belongs to; the copies are inside the root, so nothing the mount adds
 * afterwards gets out.
 *
 * The lab's own sheet is left behind. It is scoped to `#foldcase-lab`, which no
 * selector inside a shadow tree can reach anyway, so copying it would be dead
 * weight.
 *
 * `ownerDocument` is what the Mount handed us — the lab looks nothing up. Its
 * type is spelled off `Element` because `Document` is Foldkit's here.
 */
const adoptPageStyles = (shadow: ShadowRoot, owner: Element["ownerDocument"]): void => {
  shadow.appendChild(groundSheet(owner))
  for (const sheet of Array.from(owner.styleSheets)) {
    const node = sheet.ownerNode
    if (node === null || (node as Element).id === LAB_STYLE_ID) {
      continue
    }
    shadow.appendChild(node.cloneNode(true))
  }
}

/**
 * The ground the mount stands on: the consumer page's own background and ink.
 *
 * A component's stylesheet is written against the page it ships in. Foldkit's
 * own gallery styles its text near-black because its page is near-white, and
 * standing that on the lab's dark panel is a component nobody can read — the
 * colours are right and the ground under them is not. So the mount band takes
 * the page's ground rather than the shell's, which is the one surface on this
 * screen that belongs to the component and not to the lab.
 *
 * It is written first, so anything the page's own sheets say still wins.
 *
 * A page that paints no background of its own is still not transparent — the
 * browser paints it white, and white is what the component's author was looking
 * at while they wrote it. So that is the fallback, rather than letting the
 * shell's panel show through and standing a light component on a dark ground.
 */
const groundSheet = (owner: Element["ownerDocument"]): Element => {
  const view = owner.defaultView
  const grounds = view === null || view === undefined
    ? []
    : [view.getComputedStyle(owner.body), view.getComputedStyle(owner.documentElement)]
  const painted = grounds.find((ground) => ground.backgroundColor !== TRANSPARENT)
  const sheet = owner.createElement("style")
  sheet.textContent = `:host { display: block; background-color: ${
    painted?.backgroundColor ?? "#ffffff"
  }; color: ${grounds[0]?.color ?? "inherit"}; }`
  return sheet
}

/** What `getComputedStyle` calls a background nobody painted. */
const TRANSPARENT = "rgba(0, 0, 0, 0)"

// APPLICATION

/** A teardown for an entry whose Showcase declares no mount. */
const noTeardown = (): void => {}

/**
 * How long the lab waits for a mount to draw before it calls the mount a
 * failure: fifty looks, forty milliseconds apart, so two seconds in all.
 *
 * Two seconds is generous on purpose. The cost of waiting is a card that reads
 * "nothing mounted" for a moment longer; the cost of not waiting is a component
 * that paints on the next frame being labelled a failure, and staying labelled
 * one, which is the exact reading this check exists to prevent.
 */
const PAINT_LOOKS = 50
const PAINT_GAP = "40 millis"

/**
 * The lab shell as an ordinary Foldkit application (ADR-0004): the consumer's
 * own dev server bundles it with their Foldkit and their Effect, and nothing
 * here serves, bundles or watches.
 *
 * `load` is the one loader's output and the only way in — the lab reads the
 * record and nothing else. `devTools.overlay` is the consumer's to supply, so
 * this module never depends on `@foldkit/devtools`; switching devtools off is
 * not offered, because the Message union is what makes the lab drivable by an
 * agent and that is not an optional half of this surface.
 *
 * `showAgentPanel` removes the Agent (MCP) tab from the drawer, for a consumer
 * who runs the lab and not the server.
 */
export const makeLabApplication = (config: {
  readonly load: CatalogLoad
  readonly container: HTMLElement | null
  readonly devTools?: Exclude<DevToolsConfig, false>
  readonly showAgentPanel?: boolean
}): MakeRuntimeReturn => {
  const catalog = labCatalogOf(config.load)
  const showAgentPanel = config.showAgentPanel ?? true

  // The `mount` thunks, keyed exactly as the document is keyed. They are
  // closures, so they cannot live in the Model; the id in the Model is the
  // handle, and this map is what it opens.
  const mounts = new Map(
    config.load.loaded.flatMap(({ showcase }) =>
      showcase.mount === undefined ? [] : [[showcase.id, showcase.mount] as const],
    ),
  )

  /**
   * Put one Showcase on the canvas, in a document of its own, and then check
   * that it drew.
   *
   * The Mount hands the factory the live slot element, so the lab never looks
   * one up in the document, and the Mount's scope is that element's lifetime:
   * the `acquireRelease` finaliser runs when the element unmounts.
   *
   * **A shadow root, not the slot itself.** Two independent reasons, both from
   * the design's runtime facts. A component's stylesheet must not reach the
   * shell — a shadow root scopes it, and a `body { … }` rule inside one matches
   * nothing outside it. And `Runtime.embed` *replaces* the element it is given
   * with the embedded app's root, so handing over a node the lab's own virtual
   * DOM owns would detach it and the next patch would die on `insertBefore`.
   * The custom properties the shell declares still cascade in, which is what
   * makes the theme toggle re-skin the mount without rebuilding it.
   *
   * **The paint is checked, not assumed.** `Runtime.run` returns `undefined`
   * and throws nothing when an application paints an empty container, so this
   * waits a frame and looks at the host before reporting. A silent failure
   * becomes `PreviewFailed`, and the card says so instead of claiming Live.
   */
  const MountShowcase = Mount.define(
    "MountShowcase",
    { id: Schema.String },
    PreviewMounted,
    PreviewFailed,
  )(({ id }) => (element) =>
    Effect.gen(function* () {
      const mount = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const owner = element.ownerDocument
          const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" })
          adoptPageStyles(shadow, owner)
          const host = owner.createElement("div")
          // A Foldkit runtime dies on a container with no `id` — it keys HMR
          // model preservation by it — and because `embed` forks, it dies
          // silently. Name the host before anything is embedded in it.
          host.id = `foldcase-lab-mount-${id}`
          shadow.appendChild(host)
          const teardown = await (mounts.get(id)?.(host) ?? noTeardown)
          // `Runtime.run` restarts the app once on load to pick up the model
          // HMR preserved, so a mount can fire twice per page load in dev and
          // its finaliser can be reached twice. Tear down at most once.
          let released = false
          return {
            host,
            release: () => {
              if (released) {
                return
              }
              released = true
              teardown()
              // Not `host.remove()`: `embed` may have replaced the host with
              // the application's own root, and then the host is not what is
              // in the tree. Emptying the shadow root clears either shape.
              while (shadow.firstChild !== null) {
                shadow.firstChild.remove()
              }
            },
          }
        }),
        ({ release }) => Effect.sync(release),
      )
      // Two ways a mount paints, and one way it does not. `Runtime.embed`
      // *replaces* the host with the application's own root, which detaches the
      // host; a plain mount appends into it. Either is a paint. A host still
      // attached and still empty is the silent failure this check exists for.
      //
      // It is watched rather than sampled once. `update` runs on a fiber, a
      // mount may await a stylesheet or an import before it draws, and a single
      // look a fixed number of milliseconds in reports whichever the race
      // happened to leave — a component that paints on the next frame gets
      // called a failure, and stays called one. So this asks every 40ms until
      // the paint lands, and calls it a failure only once the whole window has
      // passed with nothing drawn.
      const drawn = () => mount.host.isConnected === false || mount.host.childElementCount > 0
      let painted = false
      for (let look = 0; look < PAINT_LOOKS && !painted; look += 1) {
        yield* Effect.sleep(PAINT_GAP)
        painted = drawn()
      }
      return painted ? PreviewMounted({ id }) : PreviewFailed({ id })
    }),
  )

  /**
   * The preview card: a title strip, the mount, and a bar under it.
   *
   * The slot is keyed on the selection *and* the remount counter, so both a new
   * selection and a remount destroy this element — which closes the Mount's
   * scope, which runs the teardown, which is what takes the component's Model
   * back to `init`. Teardown is the key's job, so nothing here has to remember
   * what was drawn last.
   */
  const previewCard = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html =>
    h.div(
      [h.Id("foldcase-lab-card")],
      [
        h.div(
          [h.Id("foldcase-lab-card-title"), h.DataAttribute("live", String(model.mounted))],
          [h.span([], [entry.id])],
        ),
        h.keyed("div")(
          `${entry.id}#${model.remounts}`,
          [
            h.Id("foldcase-lab-slot"),
            h.DataAttribute("mountable", String(entry.hasMount)),
            h.AriaLabel(`Canvas: ${entry.id}`),
            ...(entry.hasMount ? [h.OnMount(MountShowcase({ id: entry.id }))] : []),
          ],
          [],
        ),
        ...(entry.hasMount
          ? []
          : [
              h.p(
                [h.Id("foldcase-lab-card-empty")],
                [
                  `${entry.component} declares no mount, so there is nothing for this surface to draw. Everything the Showcase asserts still runs under foldcase test.`,
                ],
              ),
            ]),
        ...(model.mounted
          ? [
              h.div(
                [h.Id("foldcase-lab-card-model")],
                [h.b([], ["model"]), h.span([], ["held inside the mount, not on the lab's Model"])],
              ),
            ]
          : []),
      ],
    )

  /** The trail pane: what the mount relayed, and the position in it. */
  const trailPane = (model: Model, h: HtmlBuilder<Message>): Html =>
    h.aside(
      [h.Id("foldcase-lab-trail"), h.AriaLabel("Dispatch trail")],
      [
        h.div(
          [h.Id("foldcase-lab-trail-head"), h.DataAttribute("live", String(model.mounted))],
          [
            h.b([], [model.mounted ? "Live" : "Idle"]),
            h.button(
              [h.Type("button"), h.Id("foldcase-lab-trail-clear"), h.OnClick(ClearedHistory())],
              ["Clear history"],
            ),
          ],
        ),
        ...(model.trail.length === 0
          ? [
              h.p(
                [h.Id("foldcase-lab-trail-empty")],
                [
                  model.mounted
                    ? "Nothing relayed yet. Foldkit gives a host no read on a runtime it did not build, so a mount puts a Message here by posting { foldcase: \"dispatch\", tag } to the window."
                    : "The trail records real dispatches, so it fills only while a component is mounted.",
                ],
              ),
            ]
          : [
              h.ul(
                [h.Id("foldcase-lab-trail-list")],
                Arr.map(model.trail, (held, at) =>
                  h.li(
                    [],
                    [
                      h.b([], [padded(at + 1)]),
                      h.span([h.Class("foldcase-lab-diff"), h.AriaHidden(true)], []),
                      h.em([], [held.tag]),
                      h.i([], [`+${held.delta}ms`]),
                    ],
                  ),
                ),
              ),
            ]),
        h.div(
          [
            h.Id("foldcase-lab-scrubber"),
            h.DataAttribute("filled", String(model.trail.length > 0)),
          ],
          [
            h.div([h.AriaHidden(true)], [h.span([], [h.b([], [])])]),
            h.em([], [`${padded(model.trail.length)} / ${padded(model.trail.length)}`]),
          ],
        ),
      ],
    )

  /** The reason the UI exists: the component, mounted, with its trail beside it. */
  const canvasPane = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html =>
    h.div(
      [h.Id("foldcase-lab-canvas")],
      [
        h.div(
          [h.Id("foldcase-lab-canvas-bar")],
          [
            h.span(
              [],
              [
                entry.hasMount === false
                  ? "hasMount: false"
                  : model.previewFailed
                    ? "hasMount: true · the mount painted nothing"
                    : model.mounted
                      ? "mounted { update, view } · in a shadow root of its own"
                      : "hasMount: true",
              ],
            ),
            h.span([h.Class("foldcase-lab-spacer")], []),
            ...(model.mounted
              ? [
                  h.button(
                    [h.Type("button"), h.Id("foldcase-lab-remount"), h.OnClick(Remounted())],
                    ["remount"],
                  ),
                ]
              : []),
          ],
        ),
        h.div(
          [h.Id("foldcase-lab-canvas-body")],
          [
            h.div([h.Id("foldcase-lab-preview")], [previewCard(entry, model, h)]),
            trailPane(model, h),
          ],
        ),
      ],
    )

  /** Whichever of the four readings the reader chose, for the selected entry. */
  const readingOf = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html =>
    pipe(
      M.value(model.tab),
      M.withReturnType<Html>(),
      M.when("canvas", () => canvasPane(entry, model, h)),
      M.when("entry", () => entryTab(entry, h)),
      M.when("timeline", () => timelineTab(model, h)),
      M.when("schema", () => schemaTab(entry, model, h)),
      M.exhaustive,
    )

  /**
   * The trail's one source: `message` events on the window carrying the relay
   * envelope.
   *
   * It is a subscription and not a Mount because the channel outlives any one
   * mount — a component that posts from a timer, a worker or a frame of its own
   * is still relaying, and a subscription keyed to the slot would miss it.
   *
   * The gap is measured here, at the edge, against the arrival before it. That
   * keeps `update` pure: it is handed a number, and it appends a row. `lastAt`
   * is the one piece of mutable state in this module, and it is the clock —
   * exactly the thing that cannot live in a Model.
   */
  let lastAt: number | undefined
  const subscriptions = Subscription.make<Model, Message>()(() => ({
    relay: Subscription.persistent(
      Subscription.fromEventFilterMap<MessageEvent, Message>({
        target: globalThis,
        type: "message",
        toMessage: (event) =>
          Option.map(relayedTag(event.data), (tag) => {
            const at = performance.now()
            const delta = relayGapFrom(lastAt, at)
            lastAt = at
            return PreviewDispatched({ tag, delta })
          }),
      }),
    ),
  }))

  const view = (model: Model, h: HtmlBuilder<Message>): Document => {
    const entry = selectedEntry(model)
    return {
      // The address already round-trips the selection; this is the other half
      // of knowing where you are, and it costs nothing. Eight tabs open on
      // eight entries used to read "Foldcase" eight times.
      title: pipe(
        entry,
        Option.match({
          onNone: () => "Foldcase",
          onSome: (held) => `${held.id} · Foldcase`,
        }),
      ),
      body: h.div(
        [],
        [
          h.style([h.Id(LAB_STYLE_ID)], [STYLESHEET]),
          h.div(
            [h.Id("foldcase-lab"), h.DataAttribute("theme", model.theme)],
            [
              titleBar(model, h),
              h.div(
                [h.Id("foldcase-lab-frame")],
                [
                  sidebar(model, h),
                  h.main(
                    [h.Id("foldcase-lab-main"), h.AriaLabel("Selected showcase")],
                    [
                      tabBar(entry, model, h),
                      h.div(
                        [h.Id("foldcase-lab-body")],
                        [
                          ...unknownIdNotice(model.maybeUnknownId, h),
                          ...pipe(
                            entry,
                            Option.match({
                              onNone: (): ReadonlyArray<Html> => [
                                h.p(
                                  [h.Id("foldcase-lab-empty-tree"), h.Class("foldcase-lab-page")],
                                  [
                                    h.b([], ["Nothing selected"]),
                                    h.span(
                                      [],
                                      [
                                        "This catalog is empty: the load found no Showcases at the path foldcase was given.",
                                      ],
                                    ),
                                  ],
                                ),
                              ],
                              onSome: (held) => [readingOf(held, model, h)],
                            }),
                          ),
                        ],
                      ),
                      drawer(entry, model, showAgentPanel, h),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    }
  }

  return Runtime.makeApplication({
    Model,
    // The routing `init`, which is why it takes a `Url`: the address decides
    // what the lab opens on, so a cold load of `?showcase=<id>` draws that
    // Showcase and nothing has to be clicked first. That is the whole of the
    // agent's screenshot-by-id path — any agent that can drive a browser can
    // point it at an id and photograph the drawn state, with no new tool, no
    // new dependency and nothing added to the tarball. See `./address.ts`.
    init: (url) => [initialModel(catalog, url), []] as const,
    update,
    view,
    subscriptions,
    container: config.container,
    routing: {
      onUrlRequest: (request) => RequestedAddress({ request }),
      onUrlChange: (url) => ChangedAddress({ url }),
    },
    // The lab's own Message union, handed to devtools on purpose: it is what
    // lets `@foldkit/devtools-mcp`'s `foldkit_dispatch_message` drive this lab.
    // Selecting a Showcase is `SelectedShowcase({ id })`, addressed by the same
    // ids `foldcase_list_showcases` serves, so every navigation a reader
    // performs by clicking an agent performs by dispatching. No new MCP tool.
    devTools: { ...config.devTools, Message },
  })
}
