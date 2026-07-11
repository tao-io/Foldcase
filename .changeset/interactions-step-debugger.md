---
"foldcase": minor
---

Interactions panel: the play step debugger

Play functions can already break a scenario into named `step()`s. Boot now instruments
each step: it posts an append-only `StoryToShell` `play-step` variant (name, monotonic
index, and `running` -> `passed`/`failed` status, with the serialized cause on failure)
around every step body, then rethrows the wrapped error unchanged so `play-status` still
reports the failure. Because the instrumentation lives in the shared boot `step()`, it
works for every framework adapter (React, Foldkit, Solid, Vue, Svelte) with no DevTools
bridge required.

The shell collects the per-Showcase step stream (bounded, resets on story change and on
each fresh play run), and renders an ordered, live status list in a new Interactions
panel in the bottom panel region — alongside Controls, a11y, and Actions — plus a Canvas
badge showing the step count.

Tests: a unit spec for the pure step mapper and the instrumented `step()` tracker
(monotonic indices, running/passed/failed ordering, wrapped-error rethrow), and a Chromium
integration test driving a multi-step Foldkit `play` — asserting one ordered running->
terminal pair per step with correct indices and statuses, including a failing-step
scenario.

Follow-up (not in this change): clicking a step to time-travel to its Foldkit DevTools
keyframe. That correlation is Foldkit-only and requires the runtime's internal
`devToolsStore` over the `@foldkit/vite-plugin` WebSocket bridge (consumed by
`@foldkit/devtools-mcp`); there is no in-page handle to read keyframe indices, so it is
scoped as a separate bridge-coupled task.
