// A complete Foldkit component: one Model, one Message union, one pure update,
// and a view. The catalog next door showcases it both ways — a Story asserting
// on the Model the update returns, and a Scene clicking the buttons and reading
// the markup back. Neither needs a DOM: a Scene renders to Foldkit's virtual
// tree, so the whole component is tested under a bare Node or Bun. The browser
// lab does draw it, through each Showcase's `mount`.
//
// The markup is written once, in `body`, which returns `Html`. `view` wraps it
// in the `Document` a `makeApplication` app owns, and `mount` hands the same
// `body` to `Runtime.makeElement`, whose view returns `Html`.

import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
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

export const body = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.p([], [model.count.toString()]),
      h.button([h.OnClick(ClickedDecrement())], ["-"]),
      h.button([h.OnClick(ClickedReset())], ["Reset"]),
      h.button([h.OnClick(ClickedIncrement())], ["+"]),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Counter: ${model.count}`,
  body: body(model, h),
})
