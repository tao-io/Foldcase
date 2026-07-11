import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import type { Showcase } from "../runner"
import {
  introspectDocument,
  messageVariants,
  modelFields,
  renderMessageTable,
  renderModelTable,
} from "./schema-table"

/** A rendered autodoc for one Showcase: its id and the Markdown Schema tables. */
export class ShowcaseDoc extends Schema.Class<ShowcaseDoc>("ShowcaseDoc")({
  id: Schema.String,
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
 * Render one Showcase's autodoc: a titled Markdown document with a Message
 * Schema table and/or a Model Schema table. A Showcase declaring neither is
 * documented with a graceful note, not treated as a failure. Fails
 * {@link SchemaIntrospectionError} only when a declared Schema cannot be
 * introspected.
 */
export const renderShowcaseDoc = Effect.fn("foldcase.docs.renderShowcaseDoc")(function* (
  showcase: Showcase,
) {
  const message = yield* messageSection(showcase)
  const model = yield* modelSection(showcase)
  const sections = Arr.getSomes([message, model])
  const body = Arr.isReadonlyArrayEmpty(sections) ? NO_SCHEMA_NOTE : sections.join("\n\n")
  return new ShowcaseDoc({ id: showcase.id, markdown: `# ${showcase.id}\n\n${body}\n` })
})

const byId = Order.mapInput(Order.String, (showcase: Showcase) => showcase.id)

/** A Showcase autodoc written to disk: its Showcase id and the absolute file path. */
export class WrittenDoc extends Schema.Class<WrittenDoc>("WrittenDoc")({
  id: Schema.String,
  path: Schema.String,
}) {}

// Replace any run of filesystem-unsafe characters (notably the `/` in a
// Showcase id) with a single hyphen so the id maps to one flat filename.
const slug = (id: string): string => id.replaceAll(/[^a-zA-Z0-9._-]+/g, "-")

/**
 * Write one `<slug(id)>.md` file per Showcase autodoc into `outDir` (created
 * recursively), returning a {@link WrittenDoc} per file in input order. The
 * imperative shell resolves `outDir` from a CLI argument / Config.
 */
export const writeShowcaseDocs = Effect.fn("foldcase.docs.writeShowcaseDocs")(function* (
  outDir: string,
  docs: ReadonlyArray<ShowcaseDoc>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.resolve(outDir)
  yield* fs.makeDirectory(dir, { recursive: true })
  return yield* Effect.forEach(
    docs,
    (doc) =>
      Effect.gen(function* () {
        const file = path.join(dir, `${slug(doc.id)}.md`)
        yield* fs.writeFileString(file, doc.markdown)
        return new WrittenDoc({ id: doc.id, path: file })
      }),
    { concurrency: 1 },
  )
})

/**
 * Render an autodoc per Showcase, sorted by id for deterministic output. Fails
 * {@link SchemaIntrospectionError} if any Showcase's declared Schema is
 * un-introspectable.
 */
export const generateShowcaseDocs = Effect.fn("foldcase.docs.generateShowcaseDocs")(function* (
  showcases: ReadonlyArray<Showcase>,
) {
  return yield* Effect.forEach(Arr.sort(showcases, byId), renderShowcaseDoc, { concurrency: 1 })
})
