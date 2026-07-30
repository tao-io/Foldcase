import * as Schema from "effect/Schema"

import type { Showcase } from "../../src/runner"

// A showcase fixture that declares both a Message union and a Model schema, so
// `foldcase docs` has something to introspect into tables.
const Message = Schema.Union([
  Schema.TaggedStruct("Increment", {}),
  Schema.TaggedStruct("SetLabel", { label: Schema.String }),
])

class CounterModel extends Schema.Class<CounterModel>("CounterModel")({
  count: Schema.Number,
  label: Schema.String,
}) {}

export const showcases: ReadonlyArray<Showcase> = [
  { id: "counter/schema", play: () => {}, message: Message, model: CounterModel },
]
