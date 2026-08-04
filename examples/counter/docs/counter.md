# counter

Showcases: `counter/counts-up-and-down`, `counter/renders-the-controls`, `counter/reset-keeps-the-step`, `counter/starts-at-zero`, `counter/step-of-ten`, `counter/the-buttons-move-the-count`

## Messages

| Message | Field | Type | Optional |
| --- | --- | --- | --- |
| `ChangedStep` | `step` | number | no |
| `ClickedDecrement` | _(no payload)_ | — | — |
| `ClickedIncrement` | _(no payload)_ | — | — |
| `ClickedReset` | _(no payload)_ | — | — |

## Model

| Field | Type | Optional |
| --- | --- | --- |
| `count` | number | no |
| `step` | number | no |
