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
 * One function answers both questions the sidebar has — what to list and what
 * to list under it — because they are the same question asked at two depths,
 * and two functions would be two chances to disagree about a fold. A component
 * whose entries are all folded away stays in the list with none of them: the
 * heading is what unfolds it again, so dropping the heading would be a trap.
 * A component the filter emptied is dropped outright, heading and all, because
 * there is nothing under it to unfold.
 */
export const sidebarComponents = (model: Model): ReadonlyArray<LabComponent> => {
  const query = normalisedQuery(model)
  return Arr.flatMap(model.catalog.components, (component) => {
    const matched = Arr.filter(component.entries, (entry) => matchesQuery(entry, query))
    return matched.length === 0
      ? []
      : [
          new LabComponent({
            component: component.component,
            entries: isComponentExpanded(model, component.component) ? matched : [],
          }),
        ]
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
  const drawn = sidebarComponents(model).flatMap((component) =>
    component.entries.map((entry) => entry.id),
  )
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
 */
const STYLESHEET = `
#foldcase-lab { position: fixed; inset: 0; display: flex; gap: 24px;
  box-sizing: border-box; background: #fff;
  font-family: system-ui, sans-serif; padding: 24px; }
#foldcase-lab-sidebar { flex: 0 0 260px; overflow-y: auto;
  overscroll-behavior: contain; padding-right: 8px; }
#foldcase-lab-sidebar h1 { font-size: 14px; text-transform: uppercase;
  letter-spacing: 0.08em; color: #64748b; margin: 0 0 16px; }
#foldcase-lab-sidebar h2 { margin: 12px 0 4px; }
#foldcase-lab-sidebar ul { list-style: none; margin: 0; padding: 0; }
#foldcase-lab-sidebar button { display: block; width: 100%; text-align: left;
  padding: 6px 10px; border: 1px solid transparent; border-radius: 6px;
  background: none; font: inherit; font-size: 13px; cursor: pointer;
  scroll-margin: 12px 0; }
#foldcase-lab-sidebar button:hover { background: #f1f5f9; }
#foldcase-lab-sidebar button[data-selected='true'] { background: #2563eb; color: #fff; }
#foldcase-lab-sidebar button[data-group] { font-weight: 600; color: #0f172a; }
#foldcase-lab-sidebar button[data-group] span { color: #94a3b8; font-weight: 400; }
#foldcase-lab-main { flex: 1; min-width: 0; overflow-y: auto; }
#foldcase-lab-details { display: grid; grid-template-columns: max-content 1fr;
  gap: 4px 16px; margin: 0 0 20px; font-size: 13px; }
#foldcase-lab-details dt { color: #64748b; }
#foldcase-lab-details dd { margin: 0; font-family: ui-monospace, monospace; }
#foldcase-lab-canvas { border: 2px dashed #cbd5e1; border-radius: 8px;
  padding: 24px; min-height: 160px; }
#foldcase-lab-failures { margin-top: 24px; border-left: 3px solid #dc2626;
  padding-left: 12px; font-size: 12px; }
#foldcase-lab-failures h2 { color: #dc2626; }
#foldcase-lab-unknown-id { margin: 0 0 20px; border: 1px solid #f59e0b;
  border-radius: 6px; background: #fffbeb; color: #92400e;
  padding: 10px 12px; font-size: 13px; }
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
 * the factory the live element. The row is keyed on whether it is the chosen
 * one, so every new selection is a new element and this runs once for it.
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

const entryButton = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html => {
  const selected = isSelected(model, entry.id)
  return h.keyed("li")(
    // The key carries the selection, so choosing a row destroys the old element
    // and builds a new one — which is what fires the Mount above.
    `${entry.id}:${String(selected)}`,
    [],
    [
      h.button(
        [
          h.Type("button"),
          h.Id(`foldcase-lab-select-${entry.id}`),
          h.OnClick(SelectedShowcase({ id: entry.id })),
          h.DataAttribute("id", entry.id),
          h.DataAttribute("selected", String(selected)),
          h.DataAttribute("has-mount", String(entry.hasMount)),
          ...(selected ? [h.OnMount(RevealSelection({ id: entry.id }))] : []),
        ],
        [leafOf(entry.id)],
      ),
    ],
  )
}

/**
 * One component's group: a heading that folds it, and its entries when it is
 * open. Folded, the group costs one row instead of however many Showcases it
 * declares — which is how twenty-four components fit on a screen.
 */
const componentSection = (
  component: LabComponent,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const expanded = isComponentExpanded(model, component.component)
  return h.section(
    [
      h.DataAttribute("component", component.component),
      h.DataAttribute("expanded", String(expanded)),
    ],
    [
      h.h2(
        [],
        [
          h.button(
            [
              h.Type("button"),
              h.Id(`foldcase-lab-fold-${component.component}`),
              h.OnClick(ToggledComponent({ component: component.component })),
              h.DataAttribute("group", component.component),
              h.DataAttribute("expanded", String(expanded)),
            ],
            [
              `${expanded ? "▾" : "▸"} ${component.component} `,
              h.span([], [String(component.entries.length)]),
            ],
          ),
        ],
      ),
      ...(expanded
        ? [h.ul([], Arr.map(component.entries, (entry) => entryButton(entry, model, h)))]
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
            h.h2([], [`${failures.length} file(s) would not load`]),
            h.ul(
              [],
              Arr.map(failures, (failure) =>
                h.li([], [h.code([], [failure.path]), " — ", failure.reason]),
              ),
            ),
          ],
        ),
      ]

const sidebar = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Id("foldcase-lab-sidebar")],
    [
      h.h1([], [`Showcases · ${model.catalog.total}`]),
      ...Arr.map(model.catalog.components, (component) => componentSection(component, model, h)),
      ...failureSection(model.catalog.failures, h),
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
          [h.Id("foldcase-lab-unknown-id"), h.DataAttribute("unknown-id", id)],
          [`The id “${id}” is not one this catalog declares. What is drawn below is a fallback.`],
        ),
      ],
    }),
  )

/** What the record declares about the selected entry, in the record's terms. */
const details = (entry: LabEntry, h: HtmlBuilder<Message>): Html =>
  h.dl(
    [h.Id("foldcase-lab-details")],
    [
      h.dt([], ["id"]),
      h.dd([h.DataAttribute("field", "id")], [entry.id]),
      h.dt([], ["file"]),
      h.dd(
        [h.DataAttribute("field", "file")],
        [pipe(Option.fromUndefinedOr(entry.file), Option.getOrElse(() => "—"))],
      ),
      h.dt([], ["mount"]),
      h.dd([h.DataAttribute("field", "has-mount")], [String(entry.hasMount)]),
      h.dt([], ["message schema"]),
      h.dd([h.DataAttribute("field", "has-message-schema")], [String(entry.hasMessageSchema)]),
      h.dt([], ["model schema"]),
      h.dd([h.DataAttribute("field", "has-model-schema")], [String(entry.hasModelSchema)]),
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
   * A Showcase that declares no mount gets a sentence instead. That is the
   * record's answer, not an error, and most catalogs give it.
   */
  const stage = (entry: LabEntry, h: HtmlBuilder<Message>): Html =>
    entry.hasMount
      ? h.keyed("div")(
          entry.id,
          [h.Id("foldcase-lab-canvas"), h.OnMount(MountShowcase({ id: entry.id }))],
          [],
        )
      : h.p([h.Id("foldcase-lab-no-mount")], ["This showcase declares no mount."])

  const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
    title: "Foldcase lab",
    body: h.div(
      [],
      [
        h.style([], [STYLESHEET]),
        h.div(
          [h.Id("foldcase-lab")],
          [
            sidebar(model, h),
            h.main(
              [h.Id("foldcase-lab-main")],
              [
                ...unknownIdNotice(model.maybeUnknownId, h),
                ...pipe(
                  selectedEntry(model),
                  Option.match({
                    onNone: (): ReadonlyArray<Html> => [
                      h.p([h.Id("foldcase-lab-empty")], ["Nothing selected."]),
                    ],
                    onSome: (entry) => [details(entry, h), stage(entry, h)],
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
