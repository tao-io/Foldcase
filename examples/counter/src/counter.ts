// A complete Foldkit component: one Model, one Message union, one pure update,
// and a view that never runs in a Showcase. Foldcase asserts on the Model the
// update returns, so the view is here to prove the point — a component can
// render and still be tested without a DOM.

import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type { Document, HtmlBuilder } from "foldkit/html"
import { m } from "foldkit/message"
import type { Return } from "foldkit/update"

// MODEL

export const Model = Schema.Struct({
  count: Schema.Number,
  step: Schema.Number,
})
export type Model = typeof Model.Type

export const initialModel: Model = { count: 0, step: 1 }

// MESSAGE

export const ClickedIncrement = m("ClickedIncrement")
export const ClickedDecrement = m("ClickedDecrement")
export const ClickedReset = m("ClickedReset")
export const ChangedStep = m("ChangedStep", { step: Schema.Number })

export const Message = Schema.Union([
  ClickedIncrement,
  ClickedDecrement,
  ClickedReset,
  ChangedStep,
])
export type Message = typeof Message.Type

// UPDATE

export const update = (model: Model, message: Message): Return<Model, Message> =>
  Match.value(message).pipe(
    Match.withReturnType<Return<Model, Message>>(),
    Match.tagsExhaustive({
      ClickedIncrement: () => [{ ...model, count: model.count + model.step }, []],
      ClickedDecrement: () => [{ ...model, count: model.count - model.step }, []],
      ClickedReset: () => [{ ...model, count: 0 }, []],
      ChangedStep: ({ step }) => [{ ...model, step }, []],
    }),
  )

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Counter: ${model.count}`,
  body: h.div(
    [],
    [
      h.p([], [model.count.toString()]),
      h.button([h.OnClick(ClickedDecrement())], ["-"]),
      h.button([h.OnClick(ClickedReset())], ["Reset"]),
      h.button([h.OnClick(ClickedIncrement())], ["+"]),
    ],
  ),
})
