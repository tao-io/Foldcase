import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { messageTableFor, modelTableFor } from "./schema-table.js"

/** The cells of one Markdown table row, split on unescaped pipes. */
const cellsOf = (row: string): ReadonlyArray<string> =>
  row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim())

const rowFor = (markdown: string, field: string): string =>
  markdown.split("\n").find((line) => line.includes(`\`${field}\``)) ?? ""

const MessageUnion = Schema.Union([
  Schema.TaggedStruct("Clicked", {}),
  Schema.TaggedStruct("KeyPressed", {
    key: Schema.String,
    shift: Schema.optional(Schema.Boolean),
  }),
])

describe("messageTableFor", () => {
  test("renders one row per Message tag → payload field, marking optionality", async () => {
    const markdown = await Effect.runPromise(messageTableFor(MessageUnion))

    expect(markdown).toContain("| Message | Field | Type | Optional |")
    // A payload-less tag is documented, not skipped.
    expect(markdown).toContain("`Clicked`")
    expect(markdown).toContain("_(no payload)_")
    // A tagged struct's fields become rows carrying type + optionality.
    expect(markdown).toContain("`KeyPressed`")
    expect(markdown).toContain("`key`")
    expect(markdown).toContain("`shift`")
    expect(markdown).toContain("string")
    expect(markdown).toContain("boolean")

    // `key` is required, `shift` is optional — the Optional column reflects `required`.
    const keyRow = markdown.split("\n").find((line) => line.includes("`key`")) ?? ""
    const shiftRow = markdown.split("\n").find((line) => line.includes("`shift`")) ?? ""
    expect(keyRow).toContain("no")
    expect(shiftRow).toContain("yes")
  })
})

// A Model whose field types contain the Markdown column separator: a union of
// string literals renders as `"Pointer" | "Keyboard"`, which splits the row
// into five cells in a three-column table and breaks the whole table.
class TriggerModel extends Schema.Class<TriggerModel>("TriggerModel")({
  trigger: Schema.Literals(["Pointer", "Keyboard"]),
}) {}

const TriggerMessage = Schema.Union([
  Schema.TaggedStruct("Activated", { by: Schema.Literals(["Pointer", "Keyboard"]) }),
])

describe("a `|` inside a rendered type", () => {
  test("is escaped in the Model table, so the row keeps its three columns", async () => {
    const markdown = await Effect.runPromise(modelTableFor(TriggerModel))
    const row = rowFor(markdown, "trigger")

    expect(cellsOf(row)).toEqual(["`trigger`", String.raw`"Pointer" \| "Keyboard"`, "no"])
  })

  test("is escaped in the Message table too, so the row keeps its four columns", async () => {
    const markdown = await Effect.runPromise(messageTableFor(TriggerMessage))
    const row = rowFor(markdown, "by")

    expect(cellsOf(row)).toEqual([
      "`Activated`",
      "`by`",
      String.raw`"Pointer" \| "Keyboard"`,
      "no",
    ])
  })
})

class DurationModel extends Schema.Class<DurationModel>("DurationModel")({
  timeout: Schema.Duration,
}) {}

describe("a Duration field", () => {
  test("documents as Duration, not as the four-branch encoding it serializes to", async () => {
    // Effect encodes a Duration as a tagged union of its representations
    // (Infinity | NegativeInfinity | Nanos | Millis) and emits no title for it,
    // so the table used to fall through to the bare `object` catch-all.
    const markdown = await Effect.runPromise(modelTableFor(DurationModel))

    expect(cellsOf(rowFor(markdown, "timeout"))).toEqual(["`timeout`", "Duration", "no"])
  })
})

class OptionModel extends Schema.Class<OptionModel>("OptionModel")({
  selected: Schema.Option(Schema.String),
  label: Schema.String,
}) {}

const OptionMessage = Schema.Union([
  Schema.TaggedStruct("Activated", { immediate: Schema.Option(Schema.Number) }),
])

describe("an Option field", () => {
  test("reads as optional and names what it may hold, not `object`", async () => {
    // `Schema.Option` encodes as Some | None, so the key is always present and
    // the old table called it a required `object` — the two facts a reader
    // needs (it may be empty, and of what) were both missing.
    const markdown = await Effect.runPromise(modelTableFor(OptionModel))

    expect(cellsOf(rowFor(markdown, "selected"))).toEqual([
      "`selected`",
      "Option<string>",
      "yes",
    ])
    // A plain required field is untouched.
    expect(cellsOf(rowFor(markdown, "label"))).toEqual(["`label`", "string", "no"])
  })

  test("reads the same way in a Message payload", async () => {
    const markdown = await Effect.runPromise(messageTableFor(OptionMessage))

    expect(cellsOf(rowFor(markdown, "immediate"))).toEqual([
      "`Activated`",
      "`immediate`",
      "Option<number>",
      "yes",
    ])
  })
})

class Priority extends Schema.Class<Priority>("Priority")({ level: Schema.Number }) {}

// A Model as a named `Schema.Class` — `toJsonSchemaDocument` emits it as a
// top-level `$ref` into `definitions`, exercising root-ref resolution.
class Model extends Schema.Class<Model>("Model")({
  clicks: Schema.Number,
  label: Schema.String,
  open: Schema.optional(Schema.Boolean),
  tags: Schema.Array(Schema.String),
  priority: Priority,
}) {}

describe("modelTableFor", () => {
  test("renders a Field | Type | Optional table, collapsing number noise and resolving $ref", async () => {
    const markdown = await Effect.runPromise(modelTableFor(Model))
    const rowFor = (field: string) =>
      markdown.split("\n").find((line) => line.includes(`\`${field}\``)) ?? ""

    expect(markdown).toContain("| Field | Type | Optional |")

    // Effect encodes a plain number as `number | "NaN" | "Infinity" | …`; the
    // table collapses that noise back to a bare `number` — the row is exactly
    // `| \`clicks\` | number | no |`, carrying no NaN/Infinity leakage.
    expect(rowFor("clicks")).toBe("| `clicks` | number | no |")
    expect(rowFor("clicks")).not.toContain("NaN")

    // An Array<string> reads as `string[]`.
    expect(rowFor("tags")).toContain("string[]")

    // A named class field resolves to its definition name via `$ref`, not `object`.
    expect(rowFor("priority")).toContain("Priority")

    // `open` is optional → the Optional column is `yes`.
    expect(rowFor("open")).toContain("boolean")
    expect(rowFor("open")).toContain("yes")

    // Fields are sorted by name for deterministic output.
    const fieldOrder = markdown
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("`")[1])
    expect(fieldOrder).toEqual(["clicks", "label", "open", "priority", "tags"])
  })
})
