import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as P from "effect/Predicate"
import * as R from "effect/Record"
import * as Schema from "effect/Schema"

/**
 * A minimal, recursive view of a JSON Schema node — only the keys the docs
 * generator reads to render a Model/Message table. Excess keys in a
 * `Schema.toJsonSchemaDocument` node (`additionalProperties`, `title`, …) are
 * ignored by decoding. Recursive via `Schema.suspend` so `properties` / `items`
 * / `anyOf` can nest.
 */
class JsonNode extends Schema.Class<JsonNode>("JsonNode")({
  type: Schema.optional(Schema.String),
  properties: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<JsonNode> => JsonNode),
    ),
  ),
  required: Schema.optional(Schema.Array(Schema.String)),
  items: Schema.optional(Schema.suspend((): Schema.Codec<JsonNode> => JsonNode)),
  anyOf: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<JsonNode> => JsonNode))),
  enum: Schema.optional(Schema.Array(Schema.Unknown)),
  $ref: Schema.optional(Schema.String),
  /**
   * The declared type's own name, carried over from the Schema's `expected`
   * annotation by {@link introspectDocument}. It is the only thing in the
   * document that survives the encoding: a `Duration` field is a number or a
   * tagged union once serialized, and its name is the fact a Model table exists
   * to report.
   */
  expected: Schema.optional(Schema.String),
}) {}

/**
 * The draft-2020-12 document shape emitted by `Schema.toJsonSchemaDocument`:
 * the root `schema` node plus any named `$ref` targets under `definitions`.
 */
class JsonSchemaDocument extends Schema.Class<JsonSchemaDocument>("JsonSchemaDocument")({
  dialect: Schema.String,
  schema: JsonNode,
  definitions: Schema.Record(Schema.String, JsonNode),
}) {}

/**
 * A component's Model or Message Schema could not be introspected into a JSON
 * Schema document (a malformed/exotic schema). Carries the offending id and a
 * reason so the generator reports which Showcase's schema is at fault.
 */
export class SchemaIntrospectionError extends Schema.TaggedErrorClass<SchemaIntrospectionError>()(
  "foldcase/SchemaIntrospectionError",
  {
    id: Schema.String,
    reason: Schema.String,
  },
) {}

const decodeDocument = Schema.decodeUnknownEffect(JsonSchemaDocument)

/**
 * Introspect a Schema into a decoded {@link JsonSchemaDocument}.
 *
 * Two deliberate departures from the plain `Schema.toJsonSchemaDocument` the
 * MCP catalog serves:
 *
 * - **`Schema.toType`** — the *decoded* side, the Model and Message a Foldkit
 *   app actually holds, rather than the wire form. A table documenting a Model
 *   should say `Duration`, not the number it serializes to.
 * - **`includeAnnotationKey`** for `expected` — the declared type's own name.
 *   It is the only identity that survives the projection, and it is a supported
 *   option rather than a reach into the Schema AST.
 *
 * `id` labels failures so the generator can name the offending Showcase.
 */
export const introspectDocument = Effect.fn("foldcase.docs.introspectDocument")(function* (
  id: string,
  schema: Schema.Top,
) {
  const raw = yield* Effect.try({
    try: () =>
      Schema.toJsonSchemaDocument(Schema.toType(schema), {
        includeAnnotationKey: (key) => key === "expected",
      }),
    catch: (cause) => new SchemaIntrospectionError({ id, reason: String(cause) }),
  })
  return yield* decodeDocument(raw).pipe(
    Effect.mapError(
      (cause) => new SchemaIntrospectionError({ id, reason: `undecodable JSON Schema: ${cause}` }),
    ),
  )
})

// TYPE RENDERING

const NUMBER_NOISE: ReadonlyArray<string> = ["NaN", "Infinity", "-Infinity"]
const PRIMITIVE_TYPES: ReadonlyArray<string> = [
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "object",
]

const isNumberNoiseEnum = (node: JsonNode): boolean =>
  node.type === "string" &&
  node.enum !== undefined &&
  node.enum.every((value) => P.isString(value) && Arr.contains(NUMBER_NOISE, value))

const refName = (ref: string): string =>
  Arr.last(ref.split("/")).pipe(Option.getOrElse(() => ref))

const renderLiteral = (value: unknown): string => (P.isString(value) ? `"${value}"` : String(value))

const renderEnum = (values: ReadonlyArray<unknown>): string => values.map(renderLiteral).join(" | ")

/** Read a node's `_tag` literal (its `enum: [tag]` discriminant), if any. */
const tagOf = (node: JsonNode): Option.Option<string> =>
  Option.fromNullishOr(node.properties?._tag?.enum?.[0]).pipe(Option.filter(P.isString))

const sameTags = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  const [a, b] = [Arr.sort(left, Order.String), Arr.sort(right, Order.String)]
  return a.length === b.length && a.every((tag, index) => b[index] === tag)
}

/**
 * The value node of an `Option` encoding, if the node is one.
 *
 * `Schema.Option` encodes as `Some { value } | None`, so the key is always
 * present and JSON Schema calls the field required. Documenting it as a
 * required `object` withholds both facts a reader wants: that it may be empty,
 * and of what. The type renders as `Option<T>` and the Optional column reads
 * `yes` — the column answers "can this be absent", and for an Option it can.
 */
const optionValueNode = (node: JsonNode): Option.Option<Option.Option<JsonNode>> => {
  const branches = node.anyOf ?? []
  if (branches.length !== 2 || !sameTags(["Some", "None"], Arr.getSomes(branches.map(tagOf)))) {
    return Option.none()
  }
  return Option.some(
    Arr.findFirst(branches, (branch) => Option.getOrUndefined(tagOf(branch)) === "Some").pipe(
      Option.flatMap((some) => Option.fromNullishOr(some.properties?.value)),
    ),
  )
}

/** Whether a node is an `Option` encoding — an always-present, possibly-empty field. */
const isOptionNode = (node: JsonNode): boolean => Option.isSome(optionValueNode(node))

/**
 * Render a JSON Schema node as a compact, human-readable type string. Collapses
 * the `number | "NaN" | "Infinity" | "-Infinity"` encoding Effect emits for a
 * plain `number` back to `number`, resolves `$ref` to its definition name, and
 * drops the `null` branch an optional field carries (optionality is a column).
 */
export const renderType = (node: JsonNode): string => {
  if (node.$ref !== undefined) {
    return refName(node.$ref)
  }
  if (node.anyOf !== undefined) {
    const branches = node.anyOf.filter((branch) => branch.type !== "null")
    const nonNumber = branches.filter((branch) => branch.type !== "number")
    if (branches.length !== nonNumber.length && nonNumber.every(isNumberNoiseEnum)) {
      // a number branch plus only the NaN/Infinity noise → a plain number
      return "number"
    }
    const value = optionValueNode(node)
    if (Option.isSome(value)) {
      return `Option<${Option.match(value.value, {
        onNone: () => "unknown",
        onSome: renderType,
      })}>`
    }
    if (node.expected !== undefined) {
      return node.expected
    }
    return Arr.dedupe(branches.map(renderType)).join(" | ")
  }
  if (node.expected !== undefined) {
    return node.expected
  }
  if (node.enum !== undefined) {
    return renderEnum(node.enum)
  }
  if (node.type === "array") {
    return `${node.items === undefined ? "unknown" : renderType(node.items)}[]`
  }
  if (node.type !== undefined && Arr.contains(PRIMITIVE_TYPES, node.type)) {
    return node.type
  }
  return "unknown"
}

// FIELD + VARIANT EXTRACTION

/** One documented payload field: its name, rendered type, and optionality. */
export class FieldDoc extends Schema.Class<FieldDoc>("FieldDoc")({
  name: Schema.String,
  type: Schema.String,
  optional: Schema.Boolean,
}) {}

/** One Message variant: its `_tag` and the payload fields beside `_tag`. */
export class MessageVariant extends Schema.Class<MessageVariant>("MessageVariant")({
  tag: Schema.String,
  fields: Schema.Array(FieldDoc),
}) {}

const byName = Order.mapInput(Order.String, (field: FieldDoc) => field.name)
const byTag = Order.mapInput(Order.String, (variant: MessageVariant) => variant.tag)

/** Extract the payload fields of an object node, excluding the `_tag` discriminant, sorted by name. */
const fieldsOf = (node: JsonNode, excludeTag: boolean): ReadonlyArray<FieldDoc> => {
  const properties = node.properties ?? {}
  const required = node.required ?? []
  const fields = R.toEntries(properties)
    .filter(([name]) => !(excludeTag && name === "_tag"))
    .map(
      ([name, propertyNode]) =>
        new FieldDoc({
          name,
          type: renderType(propertyNode),
          // An `Option` field is always present and may still be empty, so the
          // Optional column has to read `yes` even though `required` lists it.
          optional: !Arr.contains(required, name) || isOptionNode(propertyNode),
        }),
    )
  return Arr.sort(fields, byName)
}

/**
 * Follow a top-level `$ref` (emitted when a Model/Message is a named
 * `Schema.Class`/`TaggedClass`) into the document's `definitions`, so the object
 * node with the real `properties` is read rather than the bare reference.
 * Field-level `$ref`s are intentionally left unresolved — a field renders as its
 * definition name (e.g. `Priority`), not an inlined sub-object.
 */
const resolveRef = (document: JsonSchemaDocument, node: JsonNode): JsonNode => {
  // The chain can be more than one link long: on the decoded side a named class
  // resolves `M` → `M1`, and only the last link carries the properties. Bounded
  // by the number of definitions so a self-referential schema cannot loop.
  let current = node
  for (let hop = 0; hop <= R.size(document.definitions); hop += 1) {
    if (current.$ref === undefined) {
      return current
    }
    const next = document.definitions[refName(current.$ref)]
    if (next === undefined || next === current) {
      return current
    }
    current = next
  }
  return current
}

/** The resolved object nodes of a Message schema: a union's `anyOf` branches, or the lone struct. */
const objectNodes = (document: JsonSchemaDocument): ReadonlyArray<JsonNode> => {
  const root = resolveRef(document, document.schema)
  const nodes = root.anyOf === undefined ? [root] : root.anyOf
  return nodes.map((node) => resolveRef(document, node))
}

/** Decode a Message schema document into its variants (tag → payload fields), sorted by tag. */
export const messageVariants = (document: JsonSchemaDocument): ReadonlyArray<MessageVariant> => {
  const variants = objectNodes(document).map(
    (node) =>
      new MessageVariant({
        tag: Option.getOrElse(tagOf(node), () => "(untagged)"),
        fields: fieldsOf(node, true),
      }),
  )
  return Arr.sort(variants, byTag)
}

/** Decode a Model schema document into its fields (name → type/optional), sorted by name. */
export const modelFields = (document: JsonSchemaDocument): ReadonlyArray<FieldDoc> =>
  fieldsOf(resolveRef(document, document.schema), false)

// MARKDOWN RENDERING

const yesNo = (optional: boolean): string => (optional ? "yes" : "no")

/**
 * Escape the Markdown column separator inside a cell. A union type renders as
 * `"Pointer" | "Keyboard"`, and an unescaped `|` there splits one row into five
 * cells of a three-column table — which breaks the table from that row down.
 */
const cell = (text: string): string => text.replaceAll("|", String.raw`\|`)

/** Render the Message variants as a `Message | Field | Type | Optional` table. */
export const renderMessageTable = (variants: ReadonlyArray<MessageVariant>): string => {
  const header = ["| Message | Field | Type | Optional |", "| --- | --- | --- | --- |"]
  const rows = variants.flatMap((variant) => {
    if (Arr.isReadonlyArrayEmpty(variant.fields)) {
      return [`| \`${variant.tag}\` | _(no payload)_ | — | — |`]
    }
    return variant.fields.map(
      (field) =>
        `| \`${variant.tag}\` | \`${field.name}\` | ${cell(field.type)} | ${yesNo(field.optional)} |`,
    )
  })
  return [...header, ...rows].join("\n")
}

/** Render the Model fields as a `Field | Type | Optional` table. */
export const renderModelTable = (fields: ReadonlyArray<FieldDoc>): string => {
  if (Arr.isReadonlyArrayEmpty(fields)) {
    return "_No fields._"
  }
  const header = ["| Field | Type | Optional |", "| --- | --- | --- |"]
  const rows = fields.map(
    (field) => `| \`${field.name}\` | ${cell(field.type)} | ${yesNo(field.optional)} |`,
  )
  return [...header, ...rows].join("\n")
}

/** Introspect a Message-union Schema and render it as a Markdown table. */
export const messageTableFor = Effect.fn("foldcase.docs.messageTableFor")(function* (
  schema: Schema.Top,
) {
  const document = yield* introspectDocument("<message>", schema)
  return renderMessageTable(messageVariants(document))
})

/** Introspect a Model Schema and render it as a Markdown table. */
export const modelTableFor = Effect.fn("foldcase.docs.modelTableFor")(function* (
  schema: Schema.Top,
) {
  const document = yield* introspectDocument("<model>", schema)
  return renderModelTable(modelFields(document))
})
