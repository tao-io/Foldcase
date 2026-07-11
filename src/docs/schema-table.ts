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
 * Introspect a Schema into a decoded {@link JsonSchemaDocument}, reusing the
 * same `Schema.toJsonSchemaDocument` path the Phase-1.2 catalog server uses.
 * `id` labels failures so the generator can name the offending Showcase.
 */
export const introspectDocument = Effect.fn("foldcase.docs.introspectDocument")(function* (
  id: string,
  schema: Schema.Top,
) {
  const raw = yield* Effect.try({
    try: () => Schema.toJsonSchemaDocument(schema),
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

const refName = (ref: string): string => Arr.lastNonEmpty(ref.split("/")) ?? ref

const renderLiteral = (value: unknown): string => (P.isString(value) ? `"${value}"` : String(value))

const renderEnum = (values: ReadonlyArray<unknown>): string => values.map(renderLiteral).join(" | ")

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
    if (branches.some((branch) => branch.type === "number") && branches.every(isNumberNoiseEnum)) {
      // every non-number branch is the NaN/Infinity noise → a plain number
      return "number"
    }
    return Arr.dedupe(branches.map(renderType)).join(" | ")
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
          optional: !Arr.contains(required, name),
        }),
    )
  return Arr.sort(fields, byName)
}

/** Read a node's `_tag` literal (its `enum: [tag]` discriminant), if any. */
const tagOf = (node: JsonNode): Option.Option<string> =>
  Option.fromNullishOr(node.properties?._tag?.enum?.[0]).pipe(Option.filter(P.isString))

/**
 * Follow a top-level `$ref` (emitted when a Model/Message is a named
 * `Schema.Class`/`TaggedClass`) into the document's `definitions`, so the object
 * node with the real `properties` is read rather than the bare reference.
 * Field-level `$ref`s are intentionally left unresolved — a field renders as its
 * definition name (e.g. `Priority`), not an inlined sub-object.
 */
const resolveRef = (document: JsonSchemaDocument, node: JsonNode): JsonNode =>
  node.$ref === undefined ? node : (document.definitions[refName(node.$ref)] ?? node)

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

/** Render the Message variants as a `Message | Field | Type | Optional` table. */
export const renderMessageTable = (variants: ReadonlyArray<MessageVariant>): string => {
  const header = ["| Message | Field | Type | Optional |", "| --- | --- | --- | --- |"]
  const rows = variants.flatMap((variant) => {
    if (Arr.isReadonlyArrayEmpty(variant.fields)) {
      return [`| \`${variant.tag}\` | _(no payload)_ | — | — |`]
    }
    return variant.fields.map(
      (field) =>
        `| \`${variant.tag}\` | \`${field.name}\` | ${field.type} | ${yesNo(field.optional)} |`,
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
    (field) => `| \`${field.name}\` | ${field.type} | ${yesNo(field.optional)} |`,
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
