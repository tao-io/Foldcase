// The catalog for the counter. One array, no metadata format, no parse step.
//
// Assertions come from `node:assert`, not from `bun:test`: a Showcase is loaded
// by whichever bin you run — `foldcase` under Node, `foldcase-bun` under Bun —
// so an import that only one runtime has would tie the catalog to that runtime.
//
// `foldkit` is imported at the top level, and that was measured rather than
// assumed: nothing on that path reads `window` or `document` while the module
// loads, so both bins import this catalog with no DOM under them. Only `mount`
// reaches the DOM, and only the browser lab calls it.

import assert from "node:assert/strict"

import type { Showcase, Teardown } from "foldcase"
import { Runtime } from "foldkit"
import { Story } from "foldkit/test"

import {
  body,
  ChangedStep,
  ClickedDecrement,
  ClickedIncrement,
  ClickedReset,
  initialModel,
  Message,
  Model,
  update,
} from "./counter"

// Every `mount` below is this: embed the component in the container the lab
// gives, and hand back the handle's `dispose` as the Teardown. The container is
// the lab's — `embed` replaces it and `dispose` restores it empty — so nothing
// here creates or removes a node. Each Showcase draws the state its play ends
// in, so the canvas shows what the assertion is about.
const embedAt =
  (model: Model) =>
  (container: HTMLElement): Teardown => {
    const handle = Runtime.embed(
      Runtime.makeElement({
        Model,
        init: () => [model, []] as const,
        update,
        view: body,
        container,
      }),
    )
    return handle.dispose
  }

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/starts-at-zero",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.model((model) => assert.equal(model.count, 0)),
      ),
    mount: embedAt(initialModel),
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
    mount: embedAt({ ...initialModel, count: 1 }),
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
    mount: embedAt({ count: 10, step: 10 }),
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
    mount: embedAt({ count: 0, step: 5 }),
    message: Message,
    model: Model,
  },
]
