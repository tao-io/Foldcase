# tasks

Showcases: `tasks/adds-in-order`, `tasks/open-filter-hides-the-done-one`, `tasks/selection-is-cleared`, `tasks/toggling-one-leaves-the-other`

## Messages

| Message | Field | Type | Optional |
| --- | --- | --- | --- |
| `AddedTask` | `id` | string | no |
| `AddedTask` | `title` | string | no |
| `ChangedFilter` | `filter` | "all" \| "open" \| "done" | no |
| `ClearedSelection` | _(no payload)_ | — | — |
| `SelectedTask` | `id` | string | no |
| `ToggledTask` | `id` | string | no |

## Model

| Field | Type | Optional |
| --- | --- | --- |
| `autosaveAfter` | Duration | no |
| `filter` | "all" \| "open" \| "done" | no |
| `selected` | Option<string> | yes |
| `tasks` | Task[] | no |
