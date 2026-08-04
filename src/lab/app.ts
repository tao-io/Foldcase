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
 * How many of those the canvas can actually draw — the ones declaring a mount.
 *
 * Most catalogs declare it for a minority of their entries, and until now the
 * lab said so one entry at a time: you clicked a row to find out there was
 * nothing behind it. Counting it beside the total answers the question once, for
 * the whole list, and it is the reading of the record the lab already had —
 * `hasMount` is on every entry, and the row tag draws from the same fact.
 *
 * It counts what the filter left rather than the whole catalog, because the
 * strip sits over the list the reader is looking at and a number describing some
 * other list is worse than no number.
 */
export const drawableTotal = (model: Model): number => {
  const query = normalisedQuery(model)
  return Arr.filter(entriesOf(model.catalog), (entry) => matchesQuery(entry, query) && entry.hasMount)
    .length
}

/**
 * That count as the strip says it out loud.
 *
 * It never repeats the number standing next to it. A strip reading "146 146
 * drawable" is two facts that look like one typo, and the case where every
 * entry is drawable is the common one in a component gallery — so that case
 * gets a word instead. Zero gets a word too, because a catalog with nothing to
 * put on the canvas is a thing a reader should be told rather than a count they
 * have to notice is zero.
 */
export const drawableLabel = (model: Model): string => {
  const drawable = drawableTotal(model)
  const matching = matchingTotal(model)
  if (drawable === 0) {
    return "none drawable"
  }
  return drawable === matching ? "all drawable" : `${drawable} drawable`
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
 * styles nothing. Every rule is scoped to a `foldcase-lab-` name, and every
 * colour and both font stacks are custom properties declared on the root, so a
 * consumer restyles the whole surface by setting six values rather than by
 * out-specifying a hundred rules.
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
 * Three decisions inside that frame are worth naming.
 *
 * **The ground is warm, not blue.** `--bg`, `--panel` and `--sunken` are a
 * violet-tinted neutral ramp rather than the slate this started on, and the
 * accent is violet rather than the framework blue every dashboard defaults to.
 * The component under test is still the loudest thing on screen; the chrome
 * around it now reads as one family instead of as browser defaults.
 *
 * **Both schemes ship.** The same names are redeclared under
 * `prefers-color-scheme: dark`, and nothing else in the sheet knows which
 * scheme it is drawing. Dark costs one block because every colour was named
 * first, which is the whole argument for naming them.
 *
 * **Two type families, split by what the text is.** `--ui` sets prose, labels
 * and the names in the tree; `--mono` sets everything that is a value a reader
 * might retype — ids in the heading, file paths, counts and the row tags. That
 * division does more for the hierarchy than a third font size would.
 *
 * The contrast floor is 4.5:1 for every piece of text, measured, which is one
 * departure from where these colours came from: the muted `--ink-3` is darker
 * in light and lighter in dark than the palette it is drawn from, whose value
 * read at 3.48:1 on the panel. `--line` is a hairline between regions, so it
 * sits below that floor by design; where a line is the boundary of a control a
 * reader has to find — the filter field — the sheet uses `--line-strong`.
 */
const STYLESHEET = `
#foldcase-lab {
  --ui: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg: #f8f7fb; --panel: #ffffff; --sunken: #f2f1f6;
  --ink: #0b0c0e; --ink-2: #5c5a63; --ink-3: #67646f;
  --line: #e4e2ea; --line-strong: #c6c2d0;
  --sel: #ecebf3; --sel-hover: #f4f3f8;
  --accent: oklch(0.52 0.14 285);
  --fail: oklch(0.53 0.17 25); --fail-bg: oklch(0.96 0.03 25);
  --fail-line: oklch(0.88 0.06 25);
  --warn: #92400e; --warn-bg: #fffbeb; --warn-line: #fcd34d;
}
@media (prefers-color-scheme: dark) {
  #foldcase-lab {
    --bg: #1e1c21; --panel: #26242b; --sunken: #1a181d;
    --ink: #fafafa; --ink-2: #a7a3ae; --ink-3: #9e9aa7;
    --line: #34313a; --line-strong: #514c5c;
    --sel: #332f3d; --sel-hover: #2c2a33;
    --accent: oklch(0.76 0.11 285);
    --fail: oklch(0.71 0.16 25); --fail-bg: oklch(0.29 0.05 25);
    --fail-line: oklch(0.40 0.08 25);
    --warn: #f5c563; --warn-bg: #3a2a12; --warn-line: #6b5220;
  }
}

#foldcase-lab { position: fixed; inset: 0; display: flex; flex-direction: column;
  box-sizing: border-box; background: var(--bg); color: var(--ink);
  font-family: var(--ui); font-size: 13px; line-height: 1.45;
  -webkit-font-smoothing: antialiased; }
#foldcase-lab *, #foldcase-lab *::before, #foldcase-lab *::after { box-sizing: border-box; }
#foldcase-lab :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px;
  border-radius: 6px; }

/* The one piece of chrome that says whose lab this is. It is a bar and not a
   heading because it spans both columns: the catalog and the stage are two
   halves of one instrument, and a rule across the top is what says so. */
#foldcase-lab-bar { flex: none; height: 52px; display: flex; align-items: center;
  gap: 9px; padding: 0 14px; background: var(--panel);
  border-bottom: 1px solid var(--line); }
#foldcase-lab-bar svg { flex: none; color: var(--ink); }
#foldcase-lab-bar b { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
#foldcase-lab-bar em { font-style: normal; font-family: var(--mono);
  font-size: 11px; color: var(--ink-3); }

#foldcase-lab-frame { flex: 1; min-height: 0; display: flex; }

/* The sidebar is a column of three parts: a head that stays put, a strip that
   counts what is under it, and a tree that scrolls. Taking the head out of the
   scroller is what lets a group heading stick at top: 0 without guessing how
   tall the head above it is. */
#foldcase-lab-sidebar { flex: 0 0 292px; min-height: 0; display: flex;
  flex-direction: column; background: var(--panel);
  border-right: 1px solid var(--line); }
#foldcase-lab-sidebar-head { flex: none; padding: 10px; }
#foldcase-lab-search { display: block; width: 100%; height: 30px; padding: 0 10px;
  border: 1px solid var(--line-strong); border-radius: 6px; background: var(--sunken);
  font: inherit; font-size: 12.5px; color: var(--ink); }
#foldcase-lab-search::placeholder { color: var(--ink-3); }
#foldcase-lab-search:focus-visible { border-color: var(--accent); outline-offset: 0; }

/* What the catalog is, in one line of values: how many entries the filter left,
   how many of those the canvas can draw, and how many components hold them.
   Mono, because all three are numbers a reader compares rather than reads. */
#foldcase-lab-summary { flex: none; display: flex; align-items: center; gap: 8px;
  margin: 0; padding: 9px 12px; border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 11px;
  color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
#foldcase-lab-summary b { flex: none; font-weight: 400; color: var(--ink); }
#foldcase-lab-summary span { min-width: 0; overflow: hidden;
  text-overflow: ellipsis; }
#foldcase-lab-summary span[data-field='drawable']::before { content: '· '; }
#foldcase-lab-summary span:last-child { flex: none; margin-left: auto;
  color: var(--ink-3); }

#foldcase-lab-tree { flex: 1; min-height: 0; overflow-y: auto;
  overscroll-behavior: contain; padding: 6px 0 24px; }
#foldcase-lab-tree h3 { position: sticky; top: 0; z-index: 1; margin: 0;
  background: var(--panel); }
#foldcase-lab-tree ul { list-style: none; margin: 0 0 6px; padding: 0; }
#foldcase-lab-tree button { position: relative; display: flex; align-items: center;
  gap: 9px; width: 100%; text-align: left; padding: 5px 12px 5px 27px; border: 0;
  border-left: 2px solid transparent; background: none; font: inherit;
  font-size: 12.5px; color: var(--ink-2); cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out; }
/* The marker the reveal Mount is handed. Stretched over the row so that
   scrolling *it* into view scrolls the whole row in, margins and all — a
   zero-size span at the text baseline leaves the row half under the fold. */
.foldcase-lab-reveal { position: absolute; inset: 0; pointer-events: none;
  scroll-margin: 20px 0; }
#foldcase-lab-tree button:hover { background: var(--sel-hover); color: var(--ink); }
/* Selection is a wash and a rule, not a fill. A saturated bar was legible and
   loud enough to be the first thing the eye landed on — louder than the
   component it was pointing at. The wash alone is 1.05:1, which is a selection
   nobody can see, so the accent rule carries it and the wash confirms it. */
#foldcase-lab-tree button[data-selected='true'],
#foldcase-lab-tree button[data-selected='true']:hover { background: var(--sel);
  border-left-color: var(--accent); color: var(--ink); font-weight: 500; }
#foldcase-lab-tree button[data-group] { padding-left: 12px; gap: 7px;
  font-weight: 600; color: var(--ink); }
#foldcase-lab-tree button[data-group] svg { flex: none; color: var(--ink-3);
  transform: rotate(-90deg); transition: transform 140ms ease-out; }
#foldcase-lab-tree button[data-group][data-expanded='true'] svg { transform: none; }
#foldcase-lab-tree button[data-group] em { flex: 1; min-width: 0; font-style: normal;
  overflow: hidden; text-overflow: ellipsis; }
#foldcase-lab-tree button[data-group] span,
#foldcase-lab-tree button[data-id] i { flex: none; font-family: var(--mono);
  font-style: normal; font-weight: 400; color: var(--ink-3);
  font-variant-numeric: tabular-nums; }
#foldcase-lab-tree button[data-group] span { font-size: 10px; }
/* The one fact a row carries beyond its name: whether there is anything behind
   it to look at. Most entries in most catalogs have nothing, and finding that
   out used to cost a click each. */
#foldcase-lab-tree button[data-id] i { font-size: 9.5px; letter-spacing: 0.04em; }
#foldcase-lab-tree button[data-id] em { flex: 1; min-width: 0; font-style: normal;
  overflow: hidden; text-overflow: ellipsis; }
#foldcase-lab-empty-tree { margin: 12px 12px; color: var(--ink-2); }
#foldcase-lab-empty-tree b { display: block; color: var(--ink); }

#foldcase-lab-main { flex: 1; min-width: 0; overflow: auto;
  overscroll-behavior: contain; background: var(--sunken); }
/* Panel, like the sidebar and the bar: the chrome is one surface, and the well
   below is what the stage stands in. */
#foldcase-lab-head { position: sticky; top: 0; z-index: 1; padding: 18px 24px 14px;
  background: var(--panel); border-bottom: 1px solid var(--line); }
#foldcase-lab-head h1 { margin: 0; font-family: var(--mono); font-size: 22px;
  font-weight: 400; letter-spacing: -0.015em; color: var(--ink-3);
  overflow-wrap: anywhere; }
#foldcase-lab-head h1 b { font-weight: 500; color: var(--ink); }
#foldcase-lab-seams { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin: 12px 0 0; padding: 0; list-style: none; font-family: var(--mono);
  font-size: 11px; }
#foldcase-lab-seams li { padding: 3px 8px; border: 1px solid var(--line);
  border-radius: 5px; background: var(--sunken); color: var(--ink-2); }
#foldcase-lab-seams li[data-present='false'] { border-style: dashed;
  background: none; color: var(--ink-3); }
/* The path is in the chip row but is not a chip: it is where the record was
   declared, not a fact the record asserts. */
#foldcase-lab-seams li#foldcase-lab-file { margin-left: auto; padding: 0 0 0 12px;
  border: 0; background: none; color: var(--ink-3); overflow-wrap: anywhere; }

/* Read aloud, never drawn. The clip-rect idiom rather than display:none, which
   takes the element out of the accessibility tree along with the pixels. */
.foldcase-lab-sr { position: absolute; width: 1px; height: 1px; margin: -1px;
  padding: 0; border: 0; overflow: hidden; white-space: nowrap;
  clip-path: inset(50%); }

#foldcase-lab-stage { padding: 24px; }
/* The component sits in a card on a well, with a strip naming what is mounted.
   Centred and capped, because a component asked to fill a 2560px monitor is not
   the component anybody ships. */
#foldcase-lab-canvas { max-width: 960px; margin: 0 auto; border: 1px solid var(--line);
  border-radius: 10px; background: var(--panel); overflow: hidden; }
#foldcase-lab-canvas-head { display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-bottom: 1px solid var(--line);
  font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
#foldcase-lab-canvas-head::before { content: ''; width: 6px; height: 6px; flex: none;
  border-radius: 50%; background: var(--accent); }
#foldcase-lab-slot { padding: 28px; min-height: 260px; }
/* The slot is appended on mount, so :empty stops matching the moment the
   component draws. Until then this is the only sign the lab is working. */
#foldcase-lab-slot:empty::after { content: 'Drawing…'; color: var(--ink-3); }
#foldcase-lab-no-mount, #foldcase-lab-empty { display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; max-width: 960px;
  margin: 0 auto; border: 1px dashed var(--line-strong); border-radius: 10px;
  background: none; padding: 28px; min-height: 300px; text-align: center;
  color: var(--ink-2); }
#foldcase-lab-no-mount b, #foldcase-lab-empty b { font-size: 15px; color: var(--ink); }
#foldcase-lab-no-mount span, #foldcase-lab-empty span { max-width: 46ch; }
#foldcase-lab-no-mount code, #foldcase-lab-empty code { font-family: var(--mono);
  font-size: 12px; color: var(--ink-2); }

#foldcase-lab-failures { margin: 0 10px 10px; border: 1px solid var(--fail-line);
  border-radius: 8px; background: var(--fail-bg); padding: 10px 12px;
  font-size: 12px; }
#foldcase-lab-failures h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600;
  color: var(--fail); }
#foldcase-lab-failures ul { list-style: none; margin: 0; padding: 0;
  display: grid; gap: 6px; color: var(--ink-2); }
#foldcase-lab-failures code { display: block; font-family: var(--mono);
  color: var(--fail); overflow-wrap: anywhere; }
#foldcase-lab-unknown-id { margin: 12px 24px 0; border: 1px solid var(--warn-line);
  border-radius: 8px; background: var(--warn-bg); color: var(--warn);
  padding: 10px 12px; }
#foldcase-lab-unknown-id code { font-family: var(--mono); }

/* One column below the width where two of them stop being two columns: the
   catalog takes the top third and the stage takes the rest. Both halves are
   still their own scroll container, and the frame is still one viewport tall. */
@media (max-width: 880px) {
  #foldcase-lab-frame { flex-direction: column; }
  #foldcase-lab-sidebar { flex: 0 0 38%; border-right: 0;
    border-bottom: 1px solid var(--line); }
  #foldcase-lab-head { padding-left: 16px; padding-right: 16px; }
  #foldcase-lab-stage { padding: 16px; }
  #foldcase-lab-unknown-id { margin-left: 16px; margin-right: 16px; }
  #foldcase-lab-file { margin-left: 0; padding-left: 0; flex-basis: 100%; }
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
          h.em([], [leafOf(entry.id)]),
          // Whether the canvas has anything to draw for this row, said on the
          // row rather than found by clicking it.
          //
          // It marks the rows with *no* mount, not the rows with one. A
          // component gallery declares a mount for nearly everything, so a tag
          // on the drawable rows is a word repeated a hundred and forty-six
          // times and read none. The dead row is the exception, and it is also
          // the one that costs a click to discover — so it is the one that
          // says so up front.
          ...(entry.hasMount ? [] : [h.i([], ["NO MOUNT"])]),
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
 * What the sidebar strip says the catalog is: how many entries it holds, or —
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

/** How many components hold what is drawn, counted rather than pluralised badly. */
const componentCount = (drawn: number): string =>
  drawn === 1 ? "1 component" : `${drawn} components`

/**
 * The mark on the bar, and the only picture the lab draws.
 *
 * It is markup rather than a file because the lab ships as compiled TypeScript
 * and nothing else — there is no asset in the tarball for a stylesheet to point
 * `url()` at, and a data URI in a template literal would be an image nobody
 * could read or edit. Two paths at `evenodd`: the shell, and the three faces
 * folded inside it.
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
 * The bar across the top, which is the lab saying whose lab it is.
 *
 * It spans both columns on purpose: the catalog and the stage are two halves of
 * one instrument, and a rule across the top of both is what says so. The
 * directory beside the wordmark is the one fact the bar carries — a reader with
 * two labs open has no other way to tell which catalog is which.
 */
const titleBar = (h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Id("foldcase-lab-bar")],
    [brandMark(h), h.b([], ["Foldcase"]), h.em([], ["lab"])],
  )

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
      // The heading the tree hangs off. It is drawn for a screen reader and not
      // for the eye: the strip below says the same thing in numbers, and a
      // second word "Showcases" over a column of them earns no pixels. Dropping
      // it outright would leave the tree's group headings at h3 under the
      // details h1, which is the gap this heading exists to close.
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
        [
          h.b([], [catalogCount(model)]),
          h.span([h.DataAttribute("field", "drawable")], [drawableLabel(model)]),
          h.span([], [componentCount(components.length)]),
        ],
      ),
      ...failureSection(model.catalog.failures, h),
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
          // The path rides on the same line as the chips, pushed to the far
          // end. It used to be a paragraph of its own under them, which gave
          // the least interesting fact on the panel a row to itself.
          ...pipe(
            Option.fromUndefinedOr(entry.file),
            Option.match({
              onNone: (): ReadonlyArray<Html> => [],
              onSome: (file) => [
                h.li([h.Id("foldcase-lab-file"), h.DataAttribute("field", "file")], [file]),
              ],
            }),
          ),
        ],
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
      ? h.div(
          [h.Id("foldcase-lab-canvas")],
          [
            // A strip naming what is standing on the stage. Without it the card
            // is an unlabelled rectangle, and a component that happens to draw
            // its own border is indistinguishable from the lab's chrome.
            h.div([h.Id("foldcase-lab-canvas-head")], [`mounted · ${entry.id}`]),
            // The slot the component is embedded in, and the element the key
            // belongs to: it is the one that has to be destroyed and rebuilt
            // when the selection moves. It renders with no children of its own,
            // so the lab's virtual DOM never diffs what the embed puts inside.
            h.keyed("div")(
              entry.id,
              [
                h.Id("foldcase-lab-slot"),
                h.AriaLabel(`Canvas: ${entry.id}`),
                h.OnMount(MountShowcase({ id: entry.id })),
              ],
              [],
            ),
          ],
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
            titleBar(h),
            h.div(
          [h.Id("foldcase-lab-frame")],
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
