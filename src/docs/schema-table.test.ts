import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { messageTableFor, modelTableFor } from "./schema-table"

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
    // table collapses that noise back to a bare `number`.
    expect(rowFor("clicks")).toContain("| number |")
    expect(rowFor("clicks")).toContain("no")

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
