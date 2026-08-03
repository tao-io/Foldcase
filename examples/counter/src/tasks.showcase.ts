import assert from "node:assert/strict"

import * as Option from "effect/Option"
import type { Showcase } from "foldcase"
import { Story } from "foldkit/test"

import {
  AddedTask,
  ChangedFilter,
  ClearedSelection,
  initialModel,
  Message,
  Model,
  SelectedTask,
  ToggledTask,
  update,
  visibleTasks,
} from "./tasks"

const withTwoTasks = [
  Story.message(AddedTask({ id: "t1", title: "Write the Showcase" })),
  Story.message(AddedTask({ id: "t2", title: "Run it in CI" })),
] as const

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "tasks/adds-in-order",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        ...withTwoTasks,
        Story.model((model) => {
          assert.deepEqual(
            model.tasks.map((task) => task.title),
            ["Write the Showcase", "Run it in CI"],
          )
        }),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "tasks/toggling-one-leaves-the-other",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        ...withTwoTasks,
        Story.message(ToggledTask({ id: "t1" })),
        Story.model((model) => {
          assert.deepEqual(
            model.tasks.map((task) => task.done),
            [true, false],
          )
        }),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "tasks/open-filter-hides-the-done-one",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        ...withTwoTasks,
        Story.message(ToggledTask({ id: "t1" })),
        Story.message(ChangedFilter({ filter: "open" })),
        Story.model((model) => {
          assert.deepEqual(
            visibleTasks(model).map((task) => task.id),
            ["t2"],
          )
        }),
      ),
    message: Message,
    model: Model,
  },
  {
    id: "tasks/selection-is-cleared",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        ...withTwoTasks,
        Story.message(SelectedTask({ id: "t2" })),
        Story.model((model) => assert.deepEqual(model.selected, Option.some("t2"))),
        Story.message(ClearedSelection()),
        Story.model((model) => assert.ok(Option.isNone(model.selected))),
      ),
    message: Message,
    model: Model,
  },
]
