import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as M from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Command, Mount, Runtime } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { m } from "foldkit/message"
import { load, pushUrl, UrlRequest } from "foldkit/navigation"
import type { DevToolsConfig, MakeRuntimeReturn } from "foldkit/runtime"
import { Url, toString as urlToString } from "foldkit/url"

import type { CatalogLoad } from "../cli.js"
import { addressedId, addressOf } from "./address.js"
import type { LabEntry } from "./catalog.js"
import { LabCatalog, labCatalogOf, LabComponent } from "./catalog.js"

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
 * The canvas finished drawing a Showcase. A Mount has to name a result Message
 * — that is how the work stays visible to devtools, Scene and time travel — so
 * this is the acknowledgement `update` records and does nothing with.
 */
export const MountedShowcase = m("MountedShowcase", { id: Schema.String })

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
  MountedShowcase,
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
 * The `mount` thunks are deliberately **not** here. A Model is a Schema, and a
 * closure has no encoding — so the factory closes over them, keyed by id,
 * exactly as the document is keyed. The Model carries the id, and the id is
 * enough to find the thunk again.
 */
export const Model = Schema.Struct({
  catalog: LabCatalog,
  url: Url,
  maybeSelectedId: Schema.Option(Schema.String),
  maybeUnknownId: Schema.Option(Schema.String),
  collapsedComponents: Schema.Array(Schema.String),
  query: Schema.String,
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
    // Every group open: a lab that opened folded would hide the catalog it
    // exists to show, and folding is the reader's move to make.
    collapsedComponents: [],
    // And nothing filtered, for the same reason.
    query: "",
  }
  return { ...opened, ...selectionAt(opened, addressedId(url)) }
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
    { ...model, ...selection, ...unfoldedAt(model, selection) },
    Option.isNone(selection.maybeUnknownId)
      ? [WriteAddress({ address: addressOf(model.url, id) })]
      : [],
  ]
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
        return [{ ...model, url, ...selection, ...unfoldedAt(model, selection) }, []]
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
      MountedShowcase: () => [model, []],
      RevealedSelection: () => [model, []],
      WroteAddress: () => [model, []],
      LeftForPage: () => [model, []],
    }),
  )

// VIEW

/**
 * The one stylesheet the lab carries, so it draws as a lab in a page that
 * styles nothing. It is deliberately small — a two-column frame and enough
 * separation to read — and every rule is scoped to a `foldcase-lab-` name, so a
 * consumer's own CSS overrides it rather than fights it.
 *
 * The frame is one viewport tall and each column scrolls itself. A catalog of a
 * few hundred Showcases is a sidebar several thousand pixels long, and a page
 * that scrolls as one carries the details panel off the top the moment a reader
 * reaches for anything past the first few components — so the reader scrolls
 * down to click, then back up to read what they clicked. Two scroll containers
 * are what stop that, and they are the reason the frame is `fixed`: `100vh`
 * would still ride on whatever margin the consumer's `body` carries, and a
 * margin is exactly what the lab may not reach out and change.
 *
 * Within that frame the one decision worth naming is the ground. The lab draws
 * on `#f1f5f9` and puts the sidebar and the canvas on white, so the boundary
 * around a live component is a change of surface rather than a line drawn over
 * one. The canvas used to be a dashed rectangle, which is the mark every other
 * interface uses for a placeholder — and which read at 1.48:1 besides. The
 * component under test is the loudest thing on the screen now, and the lab's own
 * chrome is a stage it stands on.
 */
const STYLESHEET = `
#foldcase-lab { position: fixed; inset: 0; display: flex;
  box-sizing: border-box; background: #f1f5f9; color: #0f172a;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
#foldcase-lab *, #foldcase-lab *::before, #foldcase-lab *::after { box-sizing: border-box; }
#foldcase-lab :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px;
  border-radius: 6px; }

/* The sidebar is a column of two parts: a head that stays put and a tree that
   scrolls under it. Taking the head out of the scroller is what lets a group
   heading stick at top: 0 without guessing how tall the head above it is. */
#foldcase-lab-sidebar { flex: 0 0 288px; min-height: 0; display: flex;
  flex-direction: column; background: #fff;
  box-shadow: 1px 0 0 rgba(15, 23, 42, 0.08); }
#foldcase-lab-sidebar-head { flex: none; padding: 18px 16px 12px;
  border-bottom: 1px solid #e2e8f0; }
#foldcase-lab-sidebar h2 { display: flex; align-items: baseline; gap: 8px;
  margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: #475569; }
#foldcase-lab-count { margin-left: auto; font-size: 12px; font-weight: 500;
  letter-spacing: 0; text-transform: none; color: #64748b;
  font-variant-numeric: tabular-nums; }
#foldcase-lab-search { display: block; width: 100%; padding: 7px 10px;
  border: 1px solid #cbd5e1; border-radius: 7px; background: #fff;
  font: inherit; font-size: 13px; color: #0f172a; }
#foldcase-lab-search::placeholder { color: #64748b; }
#foldcase-lab-search:focus-visible { border-color: #1d4ed8; outline-offset: 0; }

#foldcase-lab-tree { flex: 1; min-height: 0; overflow-y: auto;
  overscroll-behavior: contain; padding: 8px 10px 24px; }
#foldcase-lab-tree section + section { margin-top: 2px; }
#foldcase-lab-tree h3 { position: sticky; top: 0; z-index: 1; margin: 0;
  background: #fff; }
#foldcase-lab-tree ul { list-style: none; margin: 0 0 6px; padding: 0 0 0 10px;
  border-left: 1px solid #e2e8f0; }
/* Rows used to touch edge to edge, so a leaf long enough to wrap and the row
   under it read as one four-line block. Two pixels is the whole fix. */
#foldcase-lab-tree li + li { margin-top: 2px; }
#foldcase-lab-tree button { position: relative; display: flex; align-items: center;
  gap: 8px; width: 100%; text-align: left; padding: 6px 8px; border: 0;
  border-radius: 6px; background: none; font: inherit; font-size: 13px;
  color: #334155; cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out; }
/* The marker the reveal Mount is handed. Stretched over the row so that
   scrolling *it* into view scrolls the whole row in, margins and all — a
   zero-size span at the text baseline leaves the row half under the fold. */
.foldcase-lab-reveal { position: absolute; inset: 0; pointer-events: none;
  scroll-margin: 20px 0; }
#foldcase-lab-tree button:hover { background: #e2e8f0; color: #0f172a; }
#foldcase-lab-tree button[data-selected='true'],
#foldcase-lab-tree button[data-selected='true']:hover { background: #2563eb;
  color: #fff; font-weight: 500; }
/* White reads at 5.17:1 on the selected fill; the default ring's blue does not. */
#foldcase-lab-tree button[data-selected='true']:focus-visible { outline-color: #fff; }
#foldcase-lab-tree button[data-group] { font-weight: 600; color: #0f172a;
  padding-right: 4px; }
#foldcase-lab-tree button[data-group] svg { flex: none; color: #94a3b8;
  transform: rotate(-90deg); transition: transform 140ms ease-out; }
#foldcase-lab-tree button[data-group][data-expanded='true'] svg { transform: none; }
#foldcase-lab-tree button[data-group] em { flex: 1; min-width: 0; font-style: normal;
  overflow: hidden; text-overflow: ellipsis; }
#foldcase-lab-tree button[data-group] span { color: #64748b; font-weight: 400;
  font-variant-numeric: tabular-nums; }
#foldcase-lab-empty-tree { margin: 12px 8px; color: #64748b; }
#foldcase-lab-empty-tree b { display: block; color: #0f172a; }

#foldcase-lab-main { flex: 1; min-width: 0; overflow: auto;
  overscroll-behavior: contain; }
/* White, like the sidebar: the chrome is one surface and the ground is what the
   stage stands on. It is also what keeps the muted slate legible — the same
   #64748b reads 4.76:1 here and only 4.34:1 over the ground. */
#foldcase-lab-head { position: sticky; top: 0; z-index: 1; padding: 20px 28px 16px;
  background: #fff; border-bottom: 1px solid #e2e8f0; }
#foldcase-lab-head h1 { margin: 0; font-size: 20px; font-weight: 400;
  letter-spacing: -0.01em; color: #64748b; overflow-wrap: anywhere; }
#foldcase-lab-head h1 b { font-weight: 600; color: #0f172a; }
#foldcase-lab-seams { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0;
  padding: 0; list-style: none; }
#foldcase-lab-seams li { padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 500; letter-spacing: 0.01em;
  background: #e2e8f0; color: #1e293b; }
#foldcase-lab-seams li[data-present='false'] { background: none;
  box-shadow: inset 0 0 0 1px #cbd5e1; color: #64748b; }
#foldcase-lab-file { margin: 10px 0 0; font-family: ui-monospace, SFMono-Regular,
  Menlo, monospace; font-size: 12px; color: #64748b; overflow-wrap: anywhere; }

#foldcase-lab-stage { padding: 24px 28px 32px; }
#foldcase-lab-canvas { border-radius: 10px; background: #fff; padding: 28px;
  min-height: 260px;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.1), 0 1px 3px rgba(15, 23, 42, 0.06); }
/* The slot is appended on mount, so :empty stops matching the moment the
   component draws. Until then this is the only sign the lab is working. */
#foldcase-lab-canvas:empty::after { content: 'Drawing…'; color: #94a3b8; }
#foldcase-lab-no-mount, #foldcase-lab-empty { display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; margin: 0;
  border-radius: 10px; background: #fff; padding: 28px; min-height: 260px;
  box-shadow: inset 0 0 0 1px #e2e8f0; text-align: center; color: #64748b; }
#foldcase-lab-no-mount b, #foldcase-lab-empty b { font-size: 15px; color: #334155; }
#foldcase-lab-no-mount span, #foldcase-lab-empty span { max-width: 46ch; }
#foldcase-lab-no-mount code { font-family: ui-monospace, SFMono-Regular, Menlo,
  monospace; font-size: 12px; color: #475569; }

#foldcase-lab-failures { margin: 12px 0 0; border: 1px solid #fecaca;
  border-radius: 8px; background: #fef2f2; padding: 10px 12px; font-size: 12px; }
#foldcase-lab-failures h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600;
  color: #b91c1c; }
#foldcase-lab-failures ul { list-style: none; margin: 0; padding: 0;
  display: grid; gap: 6px; color: #7f1d1d; }
#foldcase-lab-failures code { display: block; font-family: ui-monospace,
  SFMono-Regular, Menlo, monospace; color: #b91c1c; overflow-wrap: anywhere; }
#foldcase-lab-unknown-id { margin: 12px 28px 0; border: 1px solid #fcd34d;
  border-radius: 8px; background: #fffbeb; color: #92400e;
  padding: 10px 12px; }
#foldcase-lab-unknown-id code { font-family: ui-monospace, SFMono-Regular, Menlo,
  monospace; }

/* One column below the width where two of them stop being two columns: the
   catalog takes the top third and the stage takes the rest. Both halves are
   still their own scroll container, and the frame is still one viewport tall. */
@media (max-width: 880px) {
  #foldcase-lab { flex-direction: column; }
  #foldcase-lab-sidebar { flex: 0 0 38%; box-shadow: 0 1px 0 rgba(15, 23, 42, 0.08); }
  #foldcase-lab-head, #foldcase-lab-stage { padding-left: 16px; padding-right: 16px; }
  #foldcase-lab-unknown-id { margin-left: 16px; margin-right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  #foldcase-lab * { transition-duration: 1ms !important; }
}
`

/** The part of an id that is not its component namespace. */
const leafOf = (id: string): string => id.slice(id.lastIndexOf("/") + 1)

/**
 * Bring the chosen row into view, and nothing else.
 *
 * A cold load of `?showcase=<id>` selects a row that can be thousands of pixels
 * down a sidebar that now scrolls itself, and a selection nobody can see is a
 * details panel with no answer to "where did this come from". The lab may not
 * go looking for that row in the document — a surface that queries the DOM is
 * the move ADR-0001 exists to stop — and it does not have to: `OnMount` hands
 * the factory the live element. It is handed a marker that exists only inside
 * the chosen row, so every new selection builds one and this runs once for it,
 * while the row around it — and any focus on it — survives untouched.
 * `block: "nearest"` is what keeps it quiet: a row already in view is left
 * exactly where it is, so clicking about the sidebar never jerks it around.
 */
const RevealSelection = Mount.define(
  "RevealSelection",
  { id: Schema.String },
  RevealedSelection,
)(({ id }) => (element) =>
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

const entryButton = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html => {
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
          h.Id(rowIdOf(entry.id)),
          h.OnClick(SelectedShowcase({ id: entry.id })),
          h.DataAttribute("id", entry.id),
          h.DataAttribute("selected", String(selected)),
          h.DataAttribute("has-mount", String(entry.hasMount)),
          // The roving tabindex: one row of however many is in the tab order,
          // and it is the chosen one. Without it a reader reaching the canvas
          // by keyboard passes through every row in the catalog first — a
          // hundred and seventy presses in the gallery this was measured on.
          // The arrow keys on the sidebar are what move between the rest.
          h.Tabindex(selected ? 0 : -1),
          ...(selected ? [h.AriaCurrent("true")] : []),
        ],
        [
          leafOf(entry.id),
          // The marker that carries the reveal. It exists only while this row
          // is the chosen one, so it is built the moment the row is chosen and
          // that is what fires the Mount — without rebuilding the row itself.
          // It draws nothing and is hidden from the accessible name.
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
 * The disclosure mark on a group heading, drawn rather than typed.
 *
 * It was `▾` and `▸`, two characters standing in for an icon: they inherit the
 * text's weight, they sit on the baseline rather than on the row's centre, and
 * they are read out loud by a screen reader as part of the component's name.
 * One path at one stroke width is none of those things, and `aria-hidden` keeps
 * it out of the accessible name — where `aria-expanded` now says the same thing
 * properly.
 */
const foldMark = (h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox("0 0 12 12"),
      h.Width("12"),
      h.Height("12"),
      h.Fill("none"),
      h.Stroke("currentColor"),
      h.StrokeWidth("1.6"),
      h.StrokeLinecap("round"),
      h.StrokeLinejoin("round"),
      h.AriaHidden(true),
    ],
    [h.path([h.D("M3 4.5 6 7.5 9 4.5")], [])],
  )

/**
 * One component's group: a heading that folds it, and its entries when it is
 * open. Folded, the group costs one row instead of however many Showcases it
 * declares — which is how twenty-four components fit on a screen.
 *
 * The heading is `aria-expanded` and `aria-controls` over the list it owns, so
 * the fold is state a screen reader is told about rather than a glyph it reads
 * out. It is also `position: sticky`, because a leaf name is meaningless without
 * its namespace — `starts-unclicked` belongs to a button, a switch, a checkbox
 * or a radio group, and six thousand pixels down a catalog the heading is the
 * only thing that says which.
 */
const componentSection = (
  component: LabComponent,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const expanded = isComponentExpanded(model, component.component)
  const listId = `foldcase-lab-entries-${component.component}`
  return h.section(
    [
      h.DataAttribute("component", component.component),
      h.DataAttribute("expanded", String(expanded)),
    ],
    [
      h.h3(
        [],
        [
          h.button(
            [
              h.Type("button"),
              h.Id(`foldcase-lab-fold-${component.component}`),
              h.OnClick(ToggledComponent({ component: component.component })),
              h.DataAttribute("group", component.component),
              h.DataAttribute("expanded", String(expanded)),
              h.AriaExpanded(expanded),
              // Only while there is a list to point at: `aria-controls` naming
              // an element that is not in the document is a dangling reference,
              // and a folded group renders none.
              ...(expanded ? [h.AriaControls(listId)] : []),
            ],
            [
              foldMark(h),
              h.em([], [component.component]),
              h.span([], [String(component.entries.length)]),
            ],
          ),
        ],
      ),
      ...(expanded
        ? [
            h.ul(
              [h.Id(listId)],
              Arr.map(component.entries, (entry) => entryButton(entry, model, h)),
            ),
          ]
        : []),
    ],
  )
}

/**
 * The files the loader could not read, shown rather than swallowed (ADR-0001 ›
 * Amendment 2). A component missing from the list above is a question, and this
 * is where its answer is.
 */
const failureSection = (
  failures: LabCatalog["failures"],
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  failures.length === 0
    ? []
    : [
        h.section(
          [h.Id("foldcase-lab-failures")],
          [
            h.h3(
              [],
              [
                failures.length === 1
                  ? "1 file would not load"
                  : `${failures.length} files would not load`,
              ],
            ),
            h.ul(
              [],
              Arr.map(failures, (failure) =>
                h.li([], [h.code([], [failure.path]), failure.reason]),
              ),
            ),
          ],
        ),
      ]

/**
 * What the sidebar head says the catalog is: how many Showcases it holds, or —
 * once a filter is live — how many of them are left. A reader who narrowed a
 * hundred and forty-six down to three has to read that it was three of a
 * hundred and forty-six, or a short list is indistinguishable from a short
 * catalog.
 */
const catalogCount = (model: Model): string => {
  const matching = matchingTotal(model)
  return matching === model.catalog.total
    ? String(model.catalog.total)
    : `${matching} of ${model.catalog.total}`
}

/**
 * The catalog, and the one control over it.
 *
 * The head does not scroll and the tree does, which is what lets a group
 * heading stick to the top of the tree without knowing how tall the head is —
 * and it keeps the filter on screen, where a filter belongs when the thing it
 * filters is several thousand pixels long.
 */
const sidebar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const components = sidebarComponents(model)
  return h.nav(
    [
      h.Id("foldcase-lab-sidebar"),
      h.AriaLabel("Showcases"),
      // The arrow keys live on the whole sidebar and not on the tree inside it,
      // so the filter and the rows are one keyboard surface: type to narrow,
      // then walk what is left without reaching for the mouse to get out of the
      // field. `OnKeyDownFocus` moves DOM focus to the row the step lands on at
      // the same time as it dispatches, which is what makes the roving tabindex
      // below a navigation rather than a trap. Keys it does not handle are left
      // alone, so typing in the filter still types.
      h.OnKeyDownFocus((key) =>
        pipe(
          key === "ArrowDown"
            ? Option.some(1)
            : key === "ArrowUp"
              ? Option.some(-1)
              : Option.none(),
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
      h.div(
        [h.Id("foldcase-lab-sidebar-head")],
        [
          h.h2(
            [],
            ["Showcases", h.span([h.Id("foldcase-lab-count")], [catalogCount(model)])],
          ),
          h.input([
            h.Id("foldcase-lab-search"),
            h.Type("search"),
            h.Value(model.query),
            h.Placeholder("Filter by id"),
            h.AriaLabel("Filter showcases by id"),
            h.Autocomplete("off"),
            h.Spellcheck(false),
            h.OnInput((query) => TypedQuery({ query })),
          ]),
          ...failureSection(model.catalog.failures, h),
        ],
      ),
      h.div(
        [h.Id("foldcase-lab-tree")],
        components.length === 0
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
          : Arr.map(components, (component) => componentSection(component, model, h)),
      ),
    ],
  )
}

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
            h.Id("foldcase-lab-unknown-id"),
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
 * One seam the record either declares or does not, drawn as a chip.
 *
 * The word carries the fact, so `data-present` and the fill are reinforcement
 * rather than the message — a column of `true` with one `false` in it was
 * scanned by shape, which is exactly how a reader misses the one that differs.
 */
const seam = (label: string, present: boolean, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.DataAttribute("seam", label), h.DataAttribute("present", String(present))],
    [present ? label : `no ${label}`],
  )

/**
 * What the record declares about the selected entry.
 *
 * The id is the heading, split at its last slash: the namespace is the
 * component and the leaf is the Showcase, and drawing them at one size in two
 * weights says so without a second label. Everything the panel used to list as
 * `dt`/`dd` pairs of monospace booleans is three chips and a path under it.
 */
const details = (entry: LabEntry, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Id("foldcase-lab-head")],
    [
      h.h1(
        [h.DataAttribute("field", "id")],
        [`${entry.component}/`, h.b([], [leafOf(entry.id)])],
      ),
      h.ul(
        [h.Id("foldcase-lab-seams")],
        [
          seam("mount", entry.hasMount, h),
          seam("message schema", entry.hasMessageSchema, h),
          seam("model schema", entry.hasModelSchema, h),
        ],
      ),
      ...pipe(
        Option.fromUndefinedOr(entry.file),
        Option.match({
          onNone: (): ReadonlyArray<Html> => [],
          onSome: (file) => [
            h.p([h.Id("foldcase-lab-file"), h.DataAttribute("field", "file")], [file]),
          ],
        }),
      ),
    ],
  )

// APPLICATION

/** A teardown for an entry whose Showcase declares no mount. */
const noTeardown = (): void => {}

/**
 * The lab shell as an ordinary Foldkit application (ADR-0004): the consumer's
 * own dev server bundles it with their Foldkit and their Effect, and nothing
 * here serves, bundles or watches.
 *
 * `load` is the one loader's output and the only way in — the lab reads the
 * record and nothing else. `devTools.overlay` is the consumer's to supply, so
 * this module never depends on `@foldkit/devtools`; switching devtools off is
 * not offered, because the Message union below is what makes the lab drivable
 * by an agent and that is not an optional half of this surface.
 */
export const makeLabApplication = (config: {
  readonly load: CatalogLoad
  readonly container: HTMLElement | null
  readonly devTools?: Exclude<DevToolsConfig, false>
}): MakeRuntimeReturn => {
  const catalog = labCatalogOf(config.load)

  // The `mount` thunks, keyed exactly as the document is keyed. They are
  // closures, so they cannot live in the Model; the id in the Model is the
  // handle, and this map is what it opens.
  const mounts = new Map(
    config.load.loaded.flatMap(({ showcase }) =>
      showcase.mount === undefined ? [] : [[showcase.id, showcase.mount] as const],
    ),
  )

  // The Mount hands the factory the live canvas element, so the lab never looks
  // one up in the document, and the Mount's scope is that element's lifetime:
  // the `acquireRelease` finaliser runs when the element unmounts.
  //
  // What is handed over is a fresh child of the canvas, never the canvas
  // itself. `Runtime.embed` *replaces* the element it is given with the
  // embedded app's root, so handing over a node the lab's own virtual DOM owns
  // detaches it and the next patch dies on `insertBefore`. The canvas renders
  // with no children, so the lab's virtual DOM never diffs this slot.
  const MountShowcase = Mount.define(
    "MountShowcase",
    { id: Schema.String },
    MountedShowcase,
  )(({ id }) => (element) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const slot = element.ownerDocument.createElement("div")
          // A Foldkit runtime dies on a container with no `id` — it keys HMR
          // model preservation by it — and because `embed` forks, it dies
          // silently. Name the slot before anything is embedded in it.
          slot.id = `foldcase-lab-slot-${id}`
          element.appendChild(slot)
          const teardown = await (mounts.get(id)?.(slot) ?? noTeardown)
          // `Runtime.run` restarts the app once on load to pick up the model
          // HMR preserved, so a mount can fire twice per page load in dev and
          // its finaliser can be reached twice. Tear down at most once.
          let released = false
          return () => {
            if (released) {
              return
            }
            released = true
            teardown()
            slot.remove()
          }
        }),
        (teardown) => Effect.sync(teardown),
      )
      return MountedShowcase({ id })
    }),
  )

  /**
   * The canvas, keyed on the selection: changing the key destroys this element,
   * which closes the Mount's scope, which runs the finaliser above. Teardown is
   * the key's job, so nothing here has to remember what was drawn last.
   *
   * A Showcase that declares no mount gets an empty state instead, in the same
   * box and at the same height, so moving between entries never jumps the page.
   * That is the record's answer and not an error — most catalogs give it for
   * most of their entries, which is why it is written to reassure rather than to
   * apologise: the assertions still run, this surface just has nothing to draw.
   */
  const stage = (entry: LabEntry, h: HtmlBuilder<Message>): Html =>
    entry.hasMount
      ? h.keyed("div")(
          entry.id,
          [
            h.Id("foldcase-lab-canvas"),
            h.AriaLabel(`Canvas: ${entry.id}`),
            h.OnMount(MountShowcase({ id: entry.id })),
          ],
          [],
        )
      : h.p(
          [h.Id("foldcase-lab-no-mount")],
          [
            h.b([], ["Nothing to draw"]),
            h.span(
              [],
              [
                "This entry declares no ",
                h.code([], ["mount"]),
                ", so there is no live component to show. Everything it asserts still runs under ",
                h.code([], ["foldcase test"]),
                ".",
              ],
            ),
          ],
        )

  const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
    // The address already round-trips the selection; this is the other half of
    // knowing where you are, and it costs nothing. Eight tabs open on eight
    // entries used to read "Foldcase lab" eight times.
    title: pipe(
      selectedEntry(model),
      Option.match({
        onNone: () => "Foldcase lab",
        onSome: (entry) => `${entry.id} · Foldcase lab`,
      }),
    ),
    body: h.div(
      [],
      [
        h.style([], [STYLESHEET]),
        h.div(
          [h.Id("foldcase-lab")],
          [
            sidebar(model, h),
            h.main(
              [h.Id("foldcase-lab-main"), h.AriaLabel("Selected showcase")],
              [
                ...unknownIdNotice(model.maybeUnknownId, h),
                ...pipe(
                  selectedEntry(model),
                  Option.match({
                    onNone: (): ReadonlyArray<Html> => [
                      h.div(
                        [h.Id("foldcase-lab-stage")],
                        [
                          h.p(
                            [h.Id("foldcase-lab-empty")],
                            [
                              h.b([], ["Nothing selected"]),
                              h.span(
                                [],
                                [
                                  "This catalog is empty: the load found no showcases at the path ",
                                  h.code([], ["foldcase"]),
                                  " was given.",
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                    onSome: (entry) => [
                      details(entry, h),
                      h.div([h.Id("foldcase-lab-stage")], [stage(entry, h)]),
                    ],
                  }),
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  })

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
