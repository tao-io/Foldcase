// The catalog for the counter. One array, no metadata format, no parse step.
//
// Assertions come from `node:assert`, not from `bun:test`: a Showcase is loaded
// by whichever bin you run — `foldcase` under Node, `foldcase-bun` under Bun —
// so an import that only one runtime has would tie the catalog to that runtime.

import assert from "node:assert/strict"

import type { Showcase } from "foldcase"
import { Story } from "foldkit/test"

import {
  ChangedStep,
  ClickedDecrement,
  ClickedIncrement,
  ClickedReset,
  initialModel,
  Message,
  Model,
  update,
} from "./counter"

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/starts-at-zero",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.model((model) => assert.equal(model.count, 0)),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "counter/counts-up-and-down",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.message(ClickedIncrement()),
        Story.message(ClickedIncrement()),
        Story.message(ClickedDecrement()),
        Story.model((model) => assert.equal(model.count, 1)),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "counter/step-of-ten",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.message(ChangedStep({ step: 10 })),
        Story.message(ClickedIncrement()),
        Story.model((model) => {
          assert.equal(model.count, 10)
          assert.equal(model.step, 10)
        }),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "counter/reset-keeps-the-step",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.message(ChangedStep({ step: 5 })),
        Story.message(ClickedIncrement()),
        Story.message(ClickedReset()),
        Story.model((model) => {
          assert.equal(model.count, 0)
          assert.equal(model.step, 5)
        }),
      ),
    message: Message,
    model: Model,
  },
]
