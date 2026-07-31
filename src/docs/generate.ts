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
  messageVariants,
  modelFields,
  renderMessageTable,
  renderModelTable,
} from "./schema-table.js"

/**
 * A rendered autodoc for one component: its name, the Showcase ids it was
 * derived from, and the Markdown Schema tables.
 *
 * A *component* is the set of Showcases that declare the same Message and Model
 * schemas — which, in a real showcase file, is every Showcase of one component,
 * because they share the declared schema objects. Keying the output on the
 * Showcase id instead produced one identical file per Showcase: five files for
 * a component with five Showcases, differing only in their title.
 */
export class ComponentDoc extends Schema.Class<ComponentDoc>("ComponentDoc")({
  component: Schema.String,
  showcases: Schema.Array(Schema.String),
  markdown: Schema.String,
}) {}

const NO_SCHEMA_NOTE = "_No Model or Message schema declared for this Showcase._"

/** Render the `## Messages` section from a Showcase's Message-union Schema, if declared. */
const messageSection = Effect.fn("foldcase.docs.messageSection")(function* (showcase: Showcase) {
  if (showcase.message === undefined) {
    return Option.none<string>()
  }
  const document = yield* introspectDocument(showcase.id, showcase.message)
  return Option.some(`## Messages\n\n${renderMessageTable(messageVariants(document))}`)
})

/** Render the `## Model` section from a Showcase's Model Schema, if declared. */
const modelSection = Effect.fn("foldcase.docs.modelSection")(function* (showcase: Showcase) {
  if (showcase.model === undefined) {
    return Option.none<string>()
  }
  const document = yield* introspectDocument(showcase.id, showcase.model)
  return Option.some(`## Model\n\n${renderModelTable(modelFields(document))}`)
})

/**
 * The name of the component a group of Showcases documents: the `/`-separated
 * id namespace they all share (`ui/picker/initial` + `ui/picker/filtering` →
 * `ui/picker`). A lone Showcase keeps its whole id, so a one-Showcase component
 * is named exactly as it was before. Ids with nothing in common fall back to
 * the first of them, so the name is always something a reader can look up.
 */
const componentName = (showcases: ReadonlyArray<Showcase>): string => {
  const segments = showcases.map((showcase) => showcase.id.split("/"))
  const first = segments[0] ?? []
  const shared = first.filter((segment, index) =>
    segments.every((candidate) => candidate[index] === segment),
  )
  return shared.length === 0 ? (showcases[0]?.id ?? "") : shared.join("/")
}

/**
 * Whether two Showcases document the same component: they declare the very same
 * Message and Model schemas. Declaring *nothing* is not a match — two opaque
 * Showcases have no reason to share a document just because neither says
 * anything.
 */
const sameComponent = (left: Showcase, right: Showcase): boolean =>
  (left.message !== undefined || left.model !== undefined) &&
  left.message === right.message &&
  left.model === right.model

/**
 * Group Showcases into components, keeping the first-seen order of each group.
 * The grouping is by declaration, not by position, so a component whose
 * Showcases are split across files still lands in one document.
 */
const componentsOf = (
  showcases: ReadonlyArray<Showcase>,
): ReadonlyArray<ReadonlyArray<Showcase>> => {
  const groups: Array<Array<Showcase>> = []
  for (const showcase of showcases) {
    const group = groups.find((candidate) => sameComponent(candidate[0] as Showcase, showcase))
    if (group === undefined) {
      groups.push([showcase])
    } else {
      group.push(showcase)
    }
  }
  return groups
}

const byId = Order.mapInput(Order.String, (showcase: Showcase) => showcase.id)

/**
 * Render one component's autodoc: a titled Markdown document with a Message
 * Schema table and/or a Model Schema table. Every Showcase in the group
 * declares the same schemas, so the tables are read from the first of them and
 * the rest are listed by id. A component declaring neither schema is documented
 * with a graceful note, not treated as a failure. Fails
 * {@link SchemaIntrospectionError} only when a declared Schema cannot be
 * introspected.
 */
export const renderComponentDoc = Effect.fn("foldcase.docs.renderComponentDoc")(function* (
  group: ReadonlyArray<Showcase>,
) {
  const showcases = Arr.sort(group, byId)
  const head = showcases[0] as Showcase
  const message = yield* messageSection(head)
  const model = yield* modelSection(head)
  const sections = Arr.getSomes([message, model])
  const body = Arr.isReadonlyArrayEmpty(sections) ? NO_SCHEMA_NOTE : sections.join("\n\n")
  const component = componentName(showcases)
  // With the ids out of the filename, the document is the only place that says
  // which Showcases stand behind these tables. A lone Showcase is already named
  // by the title, so listing it again would be noise.
  const covered =
    showcases.length === 1
      ? []
      : [`Showcases: ${showcases.map((showcase) => `\`${showcase.id}\``).join(", ")}`]
  return new ComponentDoc({
    component,
    showcases: showcases.map((showcase) => showcase.id),
    markdown: [`# ${component}`, ...covered, body].join("\n\n") + "\n",
  })
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

const byComponent = Order.mapInput(Order.String, (doc: ComponentDoc) => doc.component)

/**
 * Render an autodoc per component, sorted by name for deterministic output.
 * Fails {@link SchemaIntrospectionError} if any declared Schema is
 * un-introspectable.
 */
export const generateComponentDocs = Effect.fn("foldcase.docs.generateComponentDocs")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  const docs = yield* Effect.forEach(componentsOf(showcases), renderComponentDoc, {
    concurrency: 1,
  })
  return Arr.sort(docs, byComponent)
})
