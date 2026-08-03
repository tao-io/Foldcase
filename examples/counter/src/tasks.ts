// A second component, with a Model worth documenting: an array of nested
// records, an Option, a Duration and a literal union. `foldcase docs` reads
// these Schemas and writes the tables in ../docs/tasks.md.

import * as Duration from "effect/Duration"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { m } from "foldkit/message"
import type { Return } from "foldkit/update"

// MODEL

export class Task extends Schema.Class<Task>("Task")({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
}) {}

export const Filter = Schema.Literals(["all", "open", "done"])
export type Filter = typeof Filter.Type

export const Model = Schema.Struct({
  tasks: Schema.Array(Task),
  selected: Schema.Option(Schema.String),
  filter: Filter,
  autosaveAfter: Schema.DurationFromMillis,
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  tasks: [],
  selected: Option.none(),
  filter: "all",
  autosaveAfter: Duration.seconds(5),
}

// MESSAGE

export const AddedTask = m("AddedTask", { id: Schema.String, title: Schema.String })
export const ToggledTask = m("ToggledTask", { id: Schema.String })
export const SelectedTask = m("SelectedTask", { id: Schema.String })
export const ClearedSelection = m("ClearedSelection")
export const ChangedFilter = m("ChangedFilter", { filter: Filter })

export const Message = Schema.Union([
  AddedTask,
  ToggledTask,
  SelectedTask,
  ClearedSelection,
  ChangedFilter,
])
export type Message = typeof Message.Type

// UPDATE

const toggle = (tasks: Model["tasks"], id: string): Model["tasks"] =>
  tasks.map((task) => (task.id === id ? new Task({ ...task, done: !task.done }) : task))

export const update = (model: Model, message: Message): Return<Model, Message> =>
  Match.value(message).pipe(
    Match.withReturnType<Return<Model, Message>>(),
    Match.tagsExhaustive({
      AddedTask: ({ id, title }) => [
        { ...model, tasks: [...model.tasks, new Task({ id, title, done: false })] },
        [],
      ],
      ToggledTask: ({ id }) => [{ ...model, tasks: toggle(model.tasks, id) }, []],
      SelectedTask: ({ id }) => [{ ...model, selected: Option.some(id) }, []],
      ClearedSelection: () => [{ ...model, selected: Option.none() }, []],
      ChangedFilter: ({ filter }) => [{ ...model, filter }, []],
    }),
  )

/** The tasks the current filter shows. Called by the view, and by a Showcase. */
export const visibleTasks = (model: Model): Model["tasks"] =>
  Match.value(model.filter).pipe(
    Match.withReturnType<Model["tasks"]>(),
    Match.when("all", () => model.tasks),
    Match.when("open", () => model.tasks.filter((task) => !task.done)),
    Match.when("done", () => model.tasks.filter((task) => task.done)),
    Match.exhaustive,
  )
