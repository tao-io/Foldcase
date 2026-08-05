import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner.js"
import {
  introspectDocument,
  messageTags,
  messageVariants,
  modelFields,
  renderMessageTable,
  renderModelTable,
} from "./schema-table.js"

/**
 * A rendered autodoc for one component: its name, the Showcase ids it was
 * derived from, and the Markdown Schema tables.
 *
 * A *component* is the set of Showcases sharing an id namespace — everything
 * before the last `/`, so `button/starts-unclicked` and `button/counts-one-click`
 * are the `button` component. That is the tool's own notion of a component
 * elsewhere: `foldcase_run_catalog` filters on an `id_prefix` like `counter/`.
 *
 * Two earlier rules failed, and both lessons are worth keeping. Keying on the
 * whole Showcase id produced one identical file per Showcase: five files for a
 * component with five Showcases, differing only in their title. Keying on
 * Schema object identity — same Message *and* same Model — fixed that for a
 * catalog where each component file declares its own schemas, and collapsed
 * completely on a real Foldkit app, which has one Model struct and one Message
 * union for the whole app with each component a slice of them: 146 Showcases
 * across 24 components wrote a single 15 KB document titled after an arbitrary
 * Showcase. The namespace is what neither identity nor the whole id could be —
 * per component, and stable whatever the app's schemas look like.
 */
/**
 * What a component's Showcases say they dispatch, held against the Message
 * union they showcase. `undispatched` are the union's tags no `play` declares
 * it sends — each one is a Showcase somebody still has to write. `unknown` are
 * the declared tags the union does not carry: a typo, or a Message renamed
 * since, which means the catalog is lying about itself.
 *
 * A component reaches this record only when the answer is *knowable*: it
 * declares a Message Schema that introspects, and at least one of its Showcases
 * declares {@link Showcase.dispatches}. So an entry with two empty lists says
 * "every Message is showcased", and no entry at all says "nobody declared" —
 * two answers one empty array could not tell apart, and the second must never
 * be read as the first.
 */
export class ComponentGap extends Schema.Class<ComponentGap>("ComponentGap")({
  component: Schema.String,
  undispatched: Schema.Array(Schema.String),
  unknown: Schema.Array(Schema.String),
}) {}

export class ComponentDoc extends Schema.Class<ComponentDoc>("ComponentDoc")({
  component: Schema.String,
  showcases: Schema.Array(Schema.String),
  markdown: Schema.String,
  /**
   * The message-tag gap the Markdown reports, as data. The lines are in the
   * document for a reader; a caller deciding an exit code, or an agent picking
   * the next Showcase to write, must not have to read them back out of prose.
   * Absent when the gap is not knowable — see {@link ComponentGap}.
   */
  gap: Schema.optional(ComponentGap),
}) {}

/**
 * The Showcase a section reads its Schema out of: the first, in id order, that
 * declares one. A namespace need not declare uniformly — one Showcase may be
 * plain update logic while its sibling carries the schemas — and two siblings
 * may even declare different ones, because nothing stops an app re-declaring.
 * The earliest declaration wins, rather than the run failing over a
 * disagreement the app is entitled to; the `Showcases:` list names every id
 * behind the tables, so a reader can see where else to look.
 */
const declaring = (
  showcases: ReadonlyArray<Showcase>,
  field: "message" | "model",
): Option.Option<Showcase> =>
  Arr.findFirst(showcases, (showcase) => showcase[field] !== undefined)

/** Render the `## Messages` section from a component's Message-union Schema, if one is declared. */
const messageSection = Effect.fn("foldcase.docs.messageSection")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const source = declaring(showcases, "message")
  if (Option.isNone(source) || source.value.message === undefined) {
    return Option.none<string>()
  }
  const document = yield* introspectDocument(source.value.id, source.value.message)
  return Option.some(`## Messages\n\n${renderMessageTable(messageVariants(document))}`)
})

/** Render the `## Model` section from a component's Model Schema, if one is declared. */
const modelSection = Effect.fn("foldcase.docs.modelSection")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const source = declaring(showcases, "model")
  if (Option.isNone(source) || source.value.model === undefined) {
    return Option.none<string>()
  }
  const document = yield* introspectDocument(source.value.id, source.value.model)
  return Option.some(`## Model\n\n${renderModelTable(modelFields(document))}`)
})

/**
 * The component a Showcase belongs to: its id namespace, everything before the
 * last `/`. `button/starts-unclicked` → `button`; `ui/picker/initial` →
 * `ui/picker`; an id with no `/` at all is its own component. This is the same
 * notion of a component the MCP `id_prefix` filter runs on, so what one surface
 * calls `counter/` the other titles `counter`, and what the lab groups a gallery
 * by (ADR-0001 › Amendment 3 — one rule, read from here by every surface that
 * needs it rather than copied).
 */
export const componentName = (id: string): string => {
  const cut = id.lastIndexOf("/")
  return cut === -1 ? id : id.slice(0, cut)
}

/**
 * Group Showcases into components by id namespace, keeping the first-seen order
 * of each group. The grouping is by id, not by position, so a component whose
 * Showcases are split across files still lands in one document.
 */
const componentsOf = (
  showcases: ReadonlyArray<Showcase>,
): ReadonlyArray<ReadonlyArray<Showcase>> => {
  const groups = new Map<string, Array<Showcase>>()
  for (const showcase of showcases) {
    const name = componentName(showcase.id)
    const group = groups.get(name)
    if (group === undefined) {
      groups.set(name, [showcase])
    } else {
      group.push(showcase)
    }
  }
  return [...groups.values()]
}

const byId = Order.mapInput(Order.String, (showcase: Showcase) => showcase.id)

// MESSAGE-TAG COVERAGE

/**
 * Hold what a component's Showcases declare against the tags its union carries.
 * `none` when not one of them declares: a component nobody has declared for is
 * unknown, and unknown must never render as covered. An empty declaration is
 * still a declaration — a `play` that dispatches nothing says so that way.
 */
const gapOf = (
  component: string,
  union: ReadonlyArray<string>,
  showcases: ReadonlyArray<Showcase>,
): Option.Option<ComponentGap> => {
  if (showcases.every((showcase) => showcase.dispatches === undefined)) {
    return Option.none()
  }
  const declared = Arr.dedupe(showcases.flatMap((showcase) => showcase.dispatches ?? []))
  return Option.some(
    new ComponentGap({
      component,
      undispatched: union.filter((tag) => !Arr.contains(declared, tag)),
      unknown: Arr.sort(
        declared.filter((tag) => !Arr.contains(union, tag)),
        Order.String,
      ),
    }),
  )
}

/**
 * The tags of the Message union a component is documented from: the first
 * Showcase, in id order, that declares one — exactly the source the Messages
 * table reads. `none` when the component declares no Message Schema, and when
 * the one it declares will not introspect. With nothing to hold a declaration
 * against, the gap is unknown rather than empty; the table rendering is where
 * an un-introspectable Schema is reported.
 */
const unionTagsOf = Effect.fn("foldcase.docs.unionTagsOf")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const source = declaring(showcases, "message")
  if (Option.isNone(source) || source.value.message === undefined) {
    return Option.none<ReadonlyArray<string>>()
  }
  const document = yield* Effect.option(introspectDocument(source.value.id, source.value.message))
  return Option.map(document, messageTags)
})

/** The message-tag gap of one component's Showcases, when it is knowable. */
export const componentGap = Effect.fn("foldcase.docs.componentGap")(function* (
  group: ReadonlyArray<Showcase>,
) {
  const showcases = Arr.sort(group, byId)
  const head = showcases[0] as Showcase
  const union = yield* unionTagsOf(showcases)
  return Option.flatMap(union, (tags) => gapOf(componentName(head.id), tags, showcases))
})

const byGapComponent = Order.mapInput(Order.String, (gap: ComponentGap) => gap.component)

/**
 * The message-tag gaps of a whole catalog, one entry per component the answer
 * is knowable for, sorted by component. One derivation, read by two surfaces:
 * `foldcase docs` prints it under a component's Messages table, and
 * `foldcase_list_showcases` hands it to an agent as the list of Showcases that
 * are still missing.
 */
export const componentGaps = Effect.fn("foldcase.docs.componentGaps")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const gaps = yield* Effect.forEach(componentsOf(showcases), componentGap, { concurrency: 1 })
  return Arr.sort(Arr.getSomes(gaps), byGapComponent)
})

const tagList = (tags: ReadonlyArray<string>): string =>
  tags.map((tag) => `\`${tag}\``).join(", ")

/**
 * What a component's gap adds under its Messages table: the Messages nobody
 * showcases, and the declared tags the union does not carry. Each line is
 * omitted when its list is empty — a component that showcases every Message
 * says so by having nothing to report, and a line reading "none" would be
 * noise on every page. Nothing at all is printed when the gap is not knowable.
 */
const gapLines = (gap: Option.Option<ComponentGap>): ReadonlyArray<string> =>
  Option.match(gap, {
    onNone: () => [],
    onSome: (found) => [
      ...(Arr.isReadonlyArrayEmpty(found.undispatched)
        ? []
        : [`Not showcased: ${tagList(found.undispatched)}`]),
      ...(Arr.isReadonlyArrayEmpty(found.unknown)
        ? []
        : [`Unknown dispatches: ${tagList(found.unknown)}`]),
    ],
  })

/**
 * Render one component's autodoc: a titled Markdown document with a Message
 * Schema table and/or a Model Schema table, over the Showcases of one id
 * namespace sorted by id. Each table is read from the first Showcase declaring
 * that Schema. A component whose Showcases declare neither schema
 * has nothing to table and gets no document — `none`, not a failure, the same
 * way a Showcase that will not run is data rather than a crash. Fails
 * {@link SchemaIntrospectionError} only when a declared Schema cannot be
 * introspected.
 *
 * The Messages table carries the component's gap under it, when one is
 * knowable: which Messages no `play` dispatches, and which declared tags the
 * union does not have.
 */
export const renderComponentDoc = Effect.fn("foldcase.docs.renderComponentDoc")(function* (
  group: ReadonlyArray<Showcase>,
) {
  const showcases = Arr.sort(group, byId)
  const head = showcases[0] as Showcase
  const gap = yield* componentGap(showcases)
  const message = yield* messageSection(showcases)
  const model = yield* modelSection(showcases)
  const sections = Arr.getSomes([
    Option.map(message, (section) => [section, ...gapLines(gap)].join("\n\n")),
    model,
  ])
  if (Arr.isReadonlyArrayEmpty(sections)) {
    return Option.none<ComponentDoc>()
  }
  const component = componentName(head.id)
  // With the ids out of the filename, the document is the only place that says
  // which Showcases stand behind these tables. A lone Showcase is already named
  // by the title, so listing it again would be noise.
  const covered =
    showcases.length === 1
      ? []
      : [`Showcases: ${showcases.map((showcase) => `\`${showcase.id}\``).join(", ")}`]
  return Option.some(
    new ComponentDoc({
      component,
      showcases: showcases.map((showcase) => showcase.id),
      markdown: [`# ${component}`, ...covered, sections.join("\n\n")].join("\n\n") + "\n",
      gap: Option.getOrUndefined(gap),
    }),
  )
})

/** A component autodoc written to disk: the component name and the absolute path. */
export class WrittenDoc extends Schema.Class<WrittenDoc>("WrittenDoc")({
  component: Schema.String,
  path: Schema.String,
}) {}

// Replace any run of filesystem-unsafe characters (notably the `/` in a
// Showcase id) with a single hyphen so the id maps to one flat filename.
const slug = (id: string): string => id.replaceAll(/[^a-zA-Z0-9._-]+/g, "-")

/**
 * Write one `<slug(component)>.md` file per component autodoc into `outDir`
 * (created recursively), returning a {@link WrittenDoc} per file in input
 * order. The imperative shell resolves `outDir` from a CLI argument / Config.
 */
export const writeComponentDocs = Effect.fn("foldcase.docs.writeComponentDocs")(function* (
  outDir: string,
  docs: ReadonlyArray<ComponentDoc>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.resolve(outDir)
  yield* fs.makeDirectory(dir, { recursive: true })
  return yield* Effect.forEach(
    docs,
    (doc) =>
      Effect.gen(function* () {
        const file = path.join(dir, `${slug(doc.component)}.md`)
        yield* fs.writeFileString(file, doc.markdown)
        return new WrittenDoc({ component: doc.component, path: file })
      }),
    { concurrency: 1 },
  )
})

/**
 * A component autodoc the output directory does not already hold: the file it
 * would occupy, and why it differs — `missing` when there is no file there at
 * all, `changed` when the file's text is not the text this run rendered.
 */
export class StaleDoc extends Schema.Class<StaleDoc>("StaleDoc")({
  component: Schema.String,
  path: Schema.String,
  reason: Schema.Literals(["missing", "changed"]),
}) {}

/**
 * Compare each autodoc against the file it would be written to, returning one
 * {@link StaleDoc} per document that differs, in input order. Reads only: it
 * neither creates `outDir` nor touches a file, so `foldcase docs --check` can
 * decide a CI job without changing the tree it is judging.
 */
export const checkComponentDocs = Effect.fn("foldcase.docs.checkComponentDocs")(function* (
  outDir: string,
  docs: ReadonlyArray<ComponentDoc>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.resolve(outDir)
  const compared = yield* Effect.forEach(
    docs,
    (doc) =>
      Effect.gen(function* () {
        const file = path.join(dir, `${slug(doc.component)}.md`)
        const at = { component: doc.component, path: file }
        if (!(yield* fs.exists(file))) {
          return Option.some(new StaleDoc({ ...at, reason: "missing" }))
        }
        const held = yield* fs.readFileString(file)
        return held === doc.markdown
          ? Option.none<StaleDoc>()
          : Option.some(new StaleDoc({ ...at, reason: "changed" }))
      }),
    { concurrency: 1 },
  )
  return Arr.getSomes(compared)
})

const byComponent = Order.mapInput(Order.String, (doc: ComponentDoc) => doc.component)

/**
 * Render an autodoc per component, sorted by name for deterministic output. A
 * component that declares no schema drops out here rather than producing an
 * empty page. Fails {@link SchemaIntrospectionError} if any declared Schema is
 * un-introspectable.
 */
export const generateComponentDocs = Effect.fn("foldcase.docs.generateComponentDocs")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const docs = yield* Effect.forEach(componentsOf(showcases), renderComponentDoc, {
    concurrency: 1,
  })
  return Arr.sort(Arr.getSomes(docs), byComponent)
})
