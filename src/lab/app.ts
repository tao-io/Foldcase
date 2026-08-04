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
import type { LabComponent, LabEntry } from "./catalog.js"
import { LabCatalog, labCatalogOf } from "./catalog.js"

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

// UPDATE

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
      SelectedShowcase: ({ id }) => {
        const selection = selectionAt(model, Option.some(id))
        return [
          { ...model, ...selection },
          Option.isNone(selection.maybeUnknownId)
            ? [WriteAddress({ address: addressOf(model.url, id) })]
            : [],
        ]
      },
      ChangedAddress: ({ url }) => [{ ...model, url, ...selectionAt(model, addressedId(url)) }, []],
      RequestedAddress: ({ request }) =>
        pipe(
          M.value(request),
          M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(),
          M.tagsExhaustive({
            Internal: ({ url }) => [model, [WriteAddress({ address: urlToString(url) })]],
            External: ({ href }) => [model, [LeavePage({ href })]],
          }),
        ),
      MountedShowcase: () => [model, []],
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
 */
const STYLESHEET = `
#foldcase-lab { display: flex; gap: 24px; align-items: flex-start;
  font-family: system-ui, sans-serif; padding: 24px; }
#foldcase-lab-sidebar { flex: 0 0 260px; }
#foldcase-lab-sidebar h1 { font-size: 14px; text-transform: uppercase;
  letter-spacing: 0.08em; color: #64748b; margin: 0 0 16px; }
#foldcase-lab-sidebar h2 { font-size: 13px; margin: 16px 0 6px; color: #0f172a; }
#foldcase-lab-sidebar ul { list-style: none; margin: 0; padding: 0; }
#foldcase-lab-sidebar button { display: block; width: 100%; text-align: left;
  padding: 6px 10px; border: 1px solid transparent; border-radius: 6px;
  background: none; font: inherit; font-size: 13px; cursor: pointer; }
#foldcase-lab-sidebar button:hover { background: #f1f5f9; }
#foldcase-lab-sidebar button[data-selected='true'] { background: #2563eb; color: #fff; }
#foldcase-lab-main { flex: 1; min-width: 0; }
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

const entryButton = (entry: LabEntry, model: Model, h: HtmlBuilder<Message>): Html =>
  h.li(
    [],
    [
      h.button(
        [
          h.Type("button"),
          h.Id(`foldcase-lab-select-${entry.id}`),
          h.OnClick(SelectedShowcase({ id: entry.id })),
          h.DataAttribute("id", entry.id),
          h.DataAttribute(
            "selected",
            String(Option.contains(model.maybeSelectedId, entry.id)),
          ),
          h.DataAttribute("has-mount", String(entry.hasMount)),
        ],
        [leafOf(entry.id)],
      ),
    ],
  )

const componentSection = (
  component: LabComponent,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.DataAttribute("component", component.component)],
    [
      h.h2([], [component.component]),
      h.ul([], Arr.map(component.entries, (entry) => entryButton(entry, model, h))),
    ],
  )

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
          [`The id “${id}” is not one this catalog declares. Showing what was open instead.`],
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
