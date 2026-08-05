# Handoff: Foldcase Lab

## Overview

`foldcase lab` — a local dev-server UI that opens a browser explorer over a Foldcase Showcase catalog. Storybook's information architecture (sidebar tree → canvas → addon drawer), but for a catalog whose unit is a **Showcase** (`play` + Schemas), not a rendered component.

Foldcase upstream has **no GUI**. It is a headless CLI + MCP server. So this is net-new design, not a recreation of an existing screen. Nothing in the repo needs to be matched pixel-wise; everything below is the specification.

## About the design files

`foldcase-lab-prototype.html` is a **design reference created in HTML** — a working prototype of the intended look and behaviour. One self-contained file: no build step, no server, no network, no sibling files. Open it in any browser, offline, and click through it. Commit it next to this README so the reference stays available for as long as the spec does.

`Foldcase Lab.dc.html` is the same prototype in its authoring form, kept for diffing. It needs the prototyping runtime and will not open on its own — use the standalone file to look at the design.

Neither file is production code to copy. Both are authored as a single component with inline styles and a small state class; that shape is a property of the prototyping tool, not a recommendation.

The task is to **rebuild this UI in Foldkit** (`foldkit/foldkit`) using its own patterns: a Model/Message/update/view triple, Foldkit's `html` builders, and whatever styling layer the target app already uses.

Read the design out of *this document*, not out of the prototype's source. Two reasons, and neither is about portability:

- The prototype's styling is inline `style="…"` strings on React elements, ordered for streaming render. Ported literally, that carries prototyping scaffolding into production and freezes accidental choices as if they were decisions. The sections below name which values are decisions.
- Its state lives in one class with a `renderVals()` method. Foldkit's Model/Message/update/view is a different decomposition, and the *State* section states it in those terms.

Use the standalone file to see and feel the design — hover states, the scrubber, time travel, the failure states. Use this document for every number. Where the two disagree, this document wins.

## Fidelity

**High-fidelity.** Colours, type, spacing, and interaction states are all final and exact. Rebuild it pixel-for-pixel. Every value in this document is the value in the prototype; where a number appears here and in the file, this document is the one to trust.

Two things are deliberately *not* final:

- Fixture data (the `examples/counter` catalog, timings, coverage percentages) stands in for real runner output.
- The counter preview's `update` is a hand-copy of `examples/counter/src/counter.ts`. In production the lab imports the real module.

## Prior art to reuse, not reinvent

Two upstream sources were already mined; keep the alignment.

**Foldkit devtools overlay** (`foldkit/foldkit`, `packages/devtools/src/overlay.ts`, `overlay-styles.ts`) — the Canvas timeline is deliberately that overlay's vocabulary: zero-padded message indices, a diff dot only when the Model actually changed, `+Nms` deltas, `Live` / `Resume →` / `Clear history`, and the footer scrubber. If the overlay's styles are importable from the lab, import them rather than restating them.

**Foldcase brand** (`docs/brand/`) — `mark.svg` is used as a CSS mask over `currentColor`-ish ink, so one file serves both themes. Do not inline a recoloured copy per theme.

---

## Shell

Full viewport, no page scroll. `height: 100vh`, `display: flex`, `flex-direction: column`, `background: --bg`, `color: --ink`, base `font-size: 14px`, base family Outfit.

Three bands, top to bottom: header (fixed 52px) → body (`flex: 1`, `min-height: 0`) → nothing else. The body is a row: sidebar (fixed 292px) + main (`flex: 1`, `min-width: 0`). Main is itself a column: tab bar (40px) → canvas (`flex: 1`, `min-height: 0`, `overflow: auto`) → addon drawer (auto height, pinned bottom).

Every scroll region needs `min-height: 0` on its flex parent or it will refuse to scroll. This is the single most common way to get this layout wrong.

### Header — 52px

`height: 52px; flex: none; display: flex; align-items: center; gap: 14px; padding: 0 14px; border-bottom: 1px solid --line; background: --panel`.

Contents, left to right:

1. **Brand lockup.** `display: flex; align-items: center; gap: 9px`.
   - Mark: 22×22, `background-color: --ink`, masked with `docs/brand/mark.svg` (`center / contain no-repeat`, both `mask` and `-webkit-mask`).
   - Wordmark: "Foldcase" at 15px/700, `letter-spacing: -0.01em`. Nothing else — no "Lab" qualifier beside it.
2. **Spacer** — `flex: 1`.
3. **Run all button.** Height 30px, `padding: 0 12px`, `border: 1px solid --ink`, `radius: 6px`, `background: --ink`, `color: --bg`, 12.5px/600, `gap: 7px`. Hover `opacity: 0.85`. While running: label becomes "Running" and an 11px spinner appears before it (`1.5px solid currentColor`, `border-top-color: transparent`, circle, `animation: fc-spin 0.7s linear infinite`). When idle the spinner element is `display: none`, not removed.
4. **Theme toggle.** 30×30, centred glyph, `border: 1px solid --line`, `radius: 6px`, `background: --panel`, `color: --ink-2`, 13px. Glyph `☾` in dark, `☀` in light. Hover: `color: --ink`, `border-color: --ink-3`.

Two elements were **removed** on review and must not come back: a `FOLDCASE_SHOWCASE_DIR` path chip, and a `report-first` / `source-first` segmented toggle. The report/source split survives only as a tweakable prop (see *Props*), not as header chrome.

### Sidebar — 292px

`width: 292px; flex: none`, column, `border-right: 1px solid --line`, `background: --panel`.

**Search field.** In a `padding: 10px` box with `border-bottom: 1px solid --line`. Input is full-width, 30px tall, `padding: 0 10px`, `border: 1px solid --line`, `radius: 6px`, `background: --sunken`, `color: --ink`, 12.5px, `outline: none`, placeholder "Find a showcase". Focus: `border-color: --ink-3`.

**Summary strip.** `padding: 9px 12px`, `border-bottom: 1px solid --line`, JetBrains Mono 11px, `color: --ink-2`, `gap: 10px`. Reads `11 total` · dot+`9 passed` · dot+`2 failed` · (spacer) · `412ms` in `--ink-3`. The two dots are 6px circles in `--pass` / `--fail`. Duration reads `running…` mid-run.

**Tree.** `flex: 1; overflow: auto; padding: 6px 0 20px`. Grouping is **file → component → showcase state**.

- *File row* — full-width button, `padding: 5px 12px`, `gap: 7px`, transparent, `color: --ink-2`, JetBrains Mono 11px, left-aligned. Hover `color: --ink`. Caret (`▾` open / `▸` closed) in an 8px-wide slot, 9px, `--ink-3`. Path text truncates with ellipsis. Trailing 6px status dot, right-aligned.
- *Component row* (only when the file has visible showcases) — not interactive. `padding: 6px 12px 4px 27px`, 12.5px/600, `--ink`, followed by the visible count in JetBrains Mono 10px/400 `--ink-3`.
- *Showcase row* — full-width button, `padding: 5px 12px 5px 39px`, `gap: 9px`, 12.5px. 7px status dot; label (the id minus its `component/` prefix) truncating with ellipsis; trailing kind badge `STORY` / `SCENE` in JetBrains Mono 9.5px, `letter-spacing: 0.04em`, `--ink-3`. Selected: `background: --sel`, `color: --ink`. Unselected: transparent, `--ink-2`, hover `background: --sel-hover`.
- *Failed-file row* — when a file did not load it has no component and no children, just one row reading "did not load": `padding: 6px 12px 6px 27px`, `border-left: 2px solid --fail`, `color: --fail`, with a monospace `✗` in a fixed-width slot. Selecting it opens the load-failure canvas.

File status dot: `--fail` if the file failed to load or any of its showcases failed; `--pass` if all passed; `--ink-3` while any are pending.

Search filters showcases by substring of the full id; a file stays in the tree if it has matching showcases or its own path matches.

### Canvas tab bar — 40px

`height: 40px; flex: none; padding: 0 12px; border-bottom: 1px solid --line; background: --panel`, tabs stretched full height.

Tabs: **Canvas** · **Report** · **Timeline** · **Source** · (**View** — Scene plays only) · **Docs**. Each: `padding: 0 12px`, `border-bottom: 2px solid` (`--ink` active, `transparent` otherwise), 12.5px/500, `color: --ink` active / `--ink-3` otherwise, hover `--ink`.

Right-aligned after a spacer: the selected showcase's file path, JetBrains Mono 11px, `--ink-3`.

Default tab is **Canvas**. If the current tab does not exist for the newly selected showcase (View, on a Story), fall back to Canvas.

The canvas body gets `animation: fc-in 0.18s ease` so switching selection cross-fades rather than snapping.

---

## Canvas tab — the rendered component

The reason this UI exists. A `play` is an opaque thunk and cannot be rendered — but a component module exports `view`, so the lab mounts `{ update, view }` exactly as a Scene does and renders the real thing. The play's declared messages are folded into the real `update` to reach the state at any point.

Layout: column, `min-height: 100%`.

**Toolbar** (`flex: none`, `padding: 9px 20px`, `border-bottom: 1px solid --line`, `background: --panel`, `gap: 10px`): the text `mounted { update, view }` in JetBrains Mono 11px `--ink-3`, then a spacer, then a 3-button segmented group, then the position readout.

Segmented group — `gap: 1px`, buttons sharing borders: `‹` (26×24, radius `5px 0 0 5px`), `›` (26×24, `border-left: 0`), `replay` (24px tall, `padding: 0 9px`, `border-left: 0`, radius `0 5px 5px 0`, 11px). All `border: 1px solid --line`, `background: --panel`, `color: --ink-2`, hover `--ink`. Titles: "Step back", "Step forward", "Replay from the given model".

**Body** is a row (`flex: 1; min-height: 0`): preview surface + timeline pane.

### Preview surface

`flex: 1; min-width: 0; min-height: 280px; overflow: auto; padding: 24px; background: --sunken`, `display: flex; align-items: flex-start; justify-content: center`.

The card inside is `width: 100%; max-width: 520px; margin: auto` (auto margins so it centres while staying scrollable in both directions), `border: 1px solid --line`, `radius: 10px`, `background: --panel`, `overflow: hidden`. Three stacked bands:

1. **Title bar** — `padding: 7px 12px`, `border-bottom: 1px solid --line`, JetBrains Mono 11px `--ink-3`, `gap: 8px`: a 6px `--pass` dot then the live document title, `Counter: {count}`.
2. **The component** — `padding: 30px 32px 28px`, column, centred, `gap: 20px`. The count as JetBrains Mono 52px/500, `line-height: 1`, `letter-spacing: -0.03em`, `--ink`. Below it a `gap: 8px` row of three buttons `-`, `Reset`, `+`: `min-width: 44px` (hit target), height 34px, `padding: 0 14px`, `border: 1px solid --line`, `radius: 6px`, `background: --bg`, `color: --ink`, 14px, hover `border-color: --ink-3`. These dispatch for real.
3. **Model bar** — `padding: 9px 12px`, `border-top: 1px solid --line`, `background: --sunken`, JetBrains Mono 11.5px `--ink-2`: the label `model` in `--ink-3`, the serialized model `{ count: 0, step: 1 }`, a spacer, then a `ChangedStep 10` button (22px tall, `padding: 0 8px`, `border: 1px solid --line`, `radius: 5px`, `background: --panel`, 11px) that dispatches a payload-carrying Message.

### Timeline pane — 308px

`width: 308px; flex: none`, column, `border-left: 1px solid --line`, `background: --panel`. This is the Foldkit devtools overlay, transplanted.

**Header** — `padding: 6px 10px`, `border-bottom: 1px solid --line`, `justify-content: space-between`, `gap: 8px`.
- When at the head of history: `Live` — JetBrains Mono 12px `--pass`, preceded by a 6px `--pass` dot.
- When scrubbed back: `Resume →` — a borderless button, JetBrains Mono 12px/500 `--pass`, hover `opacity: 0.7`. Returns to the head.
- Always, on the right: `Clear history` — borderless, JetBrains Mono 12px `--ink-3`, hover `--ink`. Drops the user's own dispatches and returns to the play's trail.

**Message list** — `flex: 1; min-height: 0; overflow: auto`. One row per entry, `padding: 4px 6px`, `border-bottom: 1px solid --line`, `gap: 6px`, clickable, hover `background: --sel-hover`. Row 0 is always `init`. Columns:
- index — `min-width: 20px`, JetBrains Mono 10px `--ink-3`, zero-padded to three digits (`000`, `001`).
- diff dot — 5px circle, `--diff` when this Message changed the Model, otherwise `transparent` (the element still occupies its 5px so rows stay aligned).
- tag — `flex: 1`, truncating, JetBrains Mono 11.5px. Rendered as `ClickedIncrement()` or `ChangedStep({ step: 10 })`.
- delta — JetBrains Mono 10px `--ink-3`, `+Nms`.

Row colour: selected → `background: --sel`, `color: --ink`. Ahead of the cursor → `--ink-3`. Behind → `--ink-2`.

**Scrubber footer** — `height: 33px; flex: none; border-top: 1px solid --line`.
- Track: `flex: 1`, 16px tall hit area with `padding: 0 7px`. Inside, a 4px-tall `9999px` bar in `--line`; a fill in `--accent` at `{at / total * 100}%`; a 14px `--accent` thumb, `border: 2px solid --panel`, `left: calc({pct} - 7px)`, vertically centred by `top: 50%; margin-top: -7px`.
- Clicking anywhere on the track jumps: `round(((clientX - rect.left) / rect.width) * total)`, clamped to `[0, total]`.
- Readout: `width: 72px`, `padding-left: 12px`, `border-left: 1px solid --line`, centred, JetBrains Mono 10px `--ink-3`, `003 / 012` (both sides zero-padded to three).

### No-view state

When the selected showcase's module exports no `view` (all of `tasks`), the Canvas shows a centred column, `max-width: 420px`, `padding: 40px`: the brand mark at 30px in `--ink-3` at `opacity: 0.5`, then 13.5px/1.6 `--ink-2` text — `"{component}.ts exports no view — Story-only, so there is nothing to mount."` — then 12.5px `--ink-3`: "The Report and Timeline tabs still hold everything the play asserted on."

Do not fake a preview here. A Story-only component genuinely has nothing to render, and saying so is the correct output.

---

## Report tab

Two presentations, selected by the `canvasMode` prop.

### report-first (default)

`padding: 26px 32px 34px; max-width: 900px`.

1. Status row (`gap: 12px`, `margin-bottom: 16px`): a status pill — `padding: 4px 10px`, `radius: 6px`, JetBrains Mono 11.5px/600, background and foreground per status (below) — then `{ms}ms · fresh subprocess` in JetBrains Mono 11px `--ink-3`.
2. The id as `h1`: JetBrains Mono 22px/500, `letter-spacing: -0.015em`, margins `0 0 4px`.
3. Meta row, `gap: 14px`, `margin-bottom: 22px`, JetBrains Mono 11.5px `--ink-3`: the file path, then `play: Story` / `play: Scene`.
4. **Error block** (failures only), `margin-bottom: 24px`, `border: 1px solid --fail-line`, `radius: 9px`, `overflow: hidden`. Header: `padding: 9px 15px`, `background: --fail-bg`, `color: --fail`, JetBrains Mono 11.5px/600, the error name. Body: `<pre>`, `padding: 13px 15px`, `background: --panel`, `color: --ink`, JetBrains Mono 12px/1.65, `white-space: pre-wrap` — message and stack.
5. **Timeline** section. Heading: 11px/600, `letter-spacing: 0.07em`, uppercase, `--ink-3`, followed by a 1px `--line` rule filling the row (`gap: 9px`). Then a `border: 1px solid --line`, `radius: 9px` block with `background: --line` and `gap: 1px` between rows so the gaps read as hairlines. Each row: `display: grid; grid-template-columns: 96px 1fr auto; gap: 14px; align-items: baseline; padding: 11px 15px; background: --panel`. Columns: step kind (JetBrains Mono 10.5px/600, `letter-spacing: 0.04em`, coloured per kind), assertion text (JetBrains Mono 12.5px `--ink`, `word-break: break-word`), detail (JetBrains Mono 11.5px `--ink-3`, `white-space: nowrap`).
6. **Play** section, same heading treatment, `margin: 26px 0 12px`. A `<pre>` at `padding: 15px 17px`, `border: 1px solid --line`, `radius: 9px`, `background: --panel`, JetBrains Mono 12px/1.7 `--ink-2`, `white-space: pre-wrap` — the play's source.

### source-first

A thin sticky-feeling bar (`flex: none`, `padding: 11px 24px`, `border-bottom: 1px solid --line`, `background: --panel`, `gap: 12px`): status pill (`padding: 3px 8px`, `radius: 5px`, 11px/600) · id in JetBrains Mono 13px · spacer · duration in JetBrains Mono 11px `--ink-3`. Below it, `flex: 1; overflow: auto; padding: 18px 24px 28px`: the error `<pre>` if any (`margin-bottom: 18px`, `border: 1px solid --fail-line`, `radius: 8px`, `background: --fail-bg`, `color: --fail`, 12px/1.65), then the source as a plain `<pre>`, JetBrains Mono 12.5px/1.75 `--ink`.

### Status pill values

| status | mark | fg | bg |
| --- | --- | --- | --- |
| passed | `✓` | `--pass` | `--pass-bg` |
| failed | `✗` | `--fail` | `--fail-bg` |
| pending | `·` | `--ink-3` | `--sunken` |

## Timeline tab

`padding: 26px 32px 34px; max-width: 860px`. Opens with a 13px/1.6 `--ink-2` paragraph: "A `play` is an opaque thunk — the runner never looks inside it. This is the trace the Story recorded as it ran: the model it was given, every Message dispatched, and each assertion made on the Model that came back." (`play` in JetBrains Mono.)

Then a vertical rail: each entry is `display: grid; grid-template-columns: 18px 1fr; gap: 16px`. The left column holds a 9px dot in the step's colour with `margin-top: 5px`, then a 1px `--line` line filling the remaining height. The right column, `padding-bottom: 20px`: kind (JetBrains Mono 10.5px/600, `letter-spacing: 0.05em`, step colour, `margin-bottom: 4px`), text (JetBrains Mono 13.5px `--ink`, `margin-bottom: 5px`, `word-break: break-word`), detail (JetBrains Mono 12px `--ink-3`).

### Step kind colours

| kind | colour |
| --- | --- |
| `given` | `--ink-3` |
| `message` | `--accent` |
| `click` | `--accent` |
| `model` | `--pass` |
| `expect` | `--pass` |
| `failed` | `--fail` |

## Source tab

`padding: 22px 28px 34px`, a single `<pre>`, JetBrains Mono 12.5px/1.75, `white-space: pre-wrap`, no background.

## View tab — Scene plays only

`padding: 26px 32px 34px; max-width: 860px`. Intro paragraph, 13px/1.6 `--ink-2`: "A Scene mounts `{ update, view }` and renders to Foldkit's virtual tree — no browser, no DOM. This is that tree, and the locators the play queried it with."

Below, `display: grid; grid-template-columns: 1fr 1fr; gap: 18px`. Both panels `border: 1px solid --line`, `radius: 9px`, `background: --panel`, `overflow: hidden`, with an 8px/13px header (`border-bottom: 1px solid --line`, 11px/600, `letter-spacing: 0.06em`, uppercase, `--ink-3`).

- **Virtual tree** — a `<pre>` at `padding: 14px`, JetBrains Mono 12px/1.8, `white-space: pre-wrap`. Indented element names with accessible names and their handlers.
- **Locators** — rows at `padding: 9px 13px`, `border-bottom: 1px solid --line`, `gap: 10px`, `align-items: baseline`: a `--pass` mark in JetBrains Mono 11px, then the locator in JetBrains Mono 12px, `word-break: break-word`.

## Docs tab

`padding: 28px 32px 40px; max-width: 820px`. Documents the file's Schemas — the same content `foldcase docs` writes.

Top row (`gap: 12px`, `margin-bottom: 20px`): the doc path in a chip (`padding: 3px 8px`, `border: 1px solid --line`, `radius: 5px`, `background: --panel`, JetBrains Mono 11px `--ink-2`), spacer, then "foldcase docs — written, not parsed" in JetBrains Mono 11px `--ink-3`.

Component name as `h1`: JetBrains Mono 24px/500, `margin: 0 0 10px`. Then `Showcases:` at 12.5px/1.9 `--ink-2` with the sorted, comma-joined ids in JetBrains Mono 12px `--ink`, `margin-bottom: 30px`.

**Messages table.** Section heading 13px/600, uppercase, `letter-spacing: 0.06em`, `--ink-3`. Table is `border: 1px solid --line`, `radius: 9px`, `overflow: hidden`, `background: --panel`. Header row: `display: grid; grid-template-columns: 1.3fr 1fr 1.4fr 76px; padding: 9px 14px; border-bottom: 1px solid --line; background: --sunken`, 11px/600 uppercase `letter-spacing: 0.05em` `--ink-3` — Message · Field · Type · Optional. Body rows: same grid, `padding: 10px 14px`, `border-bottom: 1px solid --line`, JetBrains Mono 12px; first cell `--ink`, middle cells `--ink-2`, last `--ink-3`. A Message with no payload writes `(no payload)` and `—` for type and optional; a multi-field Message repeats its name on each row.

Below the table, 12.5px `--ink-2`: `Not showcased: — every Message tag is dispatched by a play.`

**Model table.** Same treatment, `grid-template-columns: 1fr 1.4fr 76px` — Field · Type · Optional.

---

## Addon drawer

`flex: none`, `border-top: 1px solid --line`, `background: --panel`, pinned to the bottom of main.

**Tab strip** — `height: 36px`, `padding: 0 12px`, `border-bottom: 1px solid --line`. Tabs: **Coverage** · **Gaps** (badge `2`) · **Agent (MCP)** (badge `6`) · **JSON**. Each: `padding: 0 11px`, `gap: 6px`, `border-bottom: 2px solid` (`--ink` active / transparent), 12px/500, `--ink` active / `--ink-3` otherwise, hover `--ink`. Badges: `padding: 1px 5px`, `radius: 4px`, `background: --sunken`, JetBrains Mono 10px `--ink-3`. Far right, a collapse toggle: `padding: 0 8px`, borderless, 14px `--ink-3`, hover `--ink`, glyph `⌄` when open / `⌃` when collapsed.

**Body** — `height: min(222px, 30vh)`, `overflow: auto`, `padding: 16px 20px 22px`. The `min()` matters: on a short viewport the drawer yields instead of starving the canvas.

- **Coverage** — a 3-column grid `1fr 130px 130px`. Header row `padding: 0 0 8px`, 11px/600 uppercase `letter-spacing: 0.05em` `--ink-3` — Showcase · Lines · Functions. Data rows `padding: 7px 0`, `border-top: 1px solid --line`, JetBrains Mono 12px; the first cell is a status mark (`✓`/`✗`/`·`, coloured) plus the id in `--ink-2`. Footer note, `margin-top: 12px`, 12px/1.6 `--ink-3`: "Collected in a spawned Node subprocess — additive, never changes the run's exit code."
- **Gaps** — an intro at 12.5px/1.6 `--ink-2`: "Held against the Message union: the tags no `play` declares it dispatches. Each one is the next Showcase to write. A component where nothing declares stays absent — unknown must never read as covered." Then one row per component: `padding: 8px 0`, `border-top: 1px solid --line`, `gap: 12px` — component name in a 110px fixed column at 12.5px/600, then the finding in JetBrains Mono 12px, `--pass` when there is no gap.
- **Agent (MCP)** — intro at 12.5px/1.6 `--ink-2`: "The same catalog over stdio. All six tools are `readOnlyHint: true`, so a host does not prompt to list a catalog." Then six rows, `display: grid; grid-template-columns: 280px 1fr; gap: 16px; padding: 8px 0; border-top: 1px solid --line` — tool name in JetBrains Mono 12px `--ink`, description at 12.5px/1.5 `--ink-2`. Tools: `foldcase_list_showcases`, `foldcase_get_showcase_schema`, `foldcase_get_showcase_model_schema`, `foldcase_run_showcase`, `foldcase_run_catalog`, `foldcase_load_catalog`. Copy for each is in the prototype's `TOOLS` array — reuse verbatim.
- **JSON** — one `<pre>`, JetBrains Mono 12px/1.7 `--ink-2`, `white-space: pre-wrap`: the suite report as `--json` would emit it, `JSON.stringify(…, null, 2)`.

---

## Interactions & behaviour

**Selection.** Clicking a showcase row selects it and **resets the preview** — scrub position back to live, user dispatches cleared. Clicking a failed-file row selects that path and forces the Report tab.

**File expand/collapse.** Per-path, default open. Collapsed hides component row and children.

**Search.** Filters live on every keystroke, case-insensitive substring against the full id.

**Run all.** Idempotent while running. Clears all statuses to pending, then reveals each entry's real status one at a time on a 130ms cadence (`setTimeout` at `130 × (i + 1)`), in catalog order, with the failed file last. `running` clears when the final entry lands. Header shows a spinner and "Running"; the summary duration reads `running…`; every not-yet-revealed dot is `--ink-3`. In production this is driven by the runner's per-showcase completion events, not a timer.

**Time travel.** `‹` and `›` step one Message, clamped. A message-list row jumps to that point. The scrubber track jumps proportionally. `replay` returns to index 0 and drops user dispatches. `Resume →` returns to the head. `Clear history` drops user dispatches and returns to the head.

**Live dispatch.** Clicking `-` / `Reset` / `+` / `ChangedStep 10` in the preview appends a Message to the trail and moves to the head. Dispatching while scrubbed back **truncates the future** first — everything after the cursor is dropped, then the new Message lands, as the devtools overlay does. `Clear history` and `replay` restore the play's own Messages.

**Theme.** Toggle swaps the whole token set. Prototype does not persist it; production should, alongside selection and tab, so a reload lands where you left off.

**Drawer collapse.** Hides the body, keeps the 36px strip.

## State

| state | type | notes |
| --- | --- | --- |
| `theme` | `'dark' \| 'light'` | falls back to the `theme` prop, then `'dark'` |
| `mode` | `'report-first' \| 'source-first'` | falls back to the `canvasMode` prop |
| `selected` | showcase id, or a file path for a load failure | |
| `tab` | tab key or null | null means the default; invalid-for-selection falls back to Canvas |
| `panel` | drawer tab key | |
| `drawerOpen` | boolean | |
| `open` | map of file path → boolean | absent means open |
| `query` | string | |
| `running` | boolean | |
| `ran` | set of revealed ids | |
| `at` | number or null | scrub position; null means live |
| `override` | array of Messages, or null | the trail; null means the play's own declared Messages, untouched |

In Foldkit terms: this is one Model with a Message per interaction above (`SelectedShowcase`, `ToggledFile`, `ChangedQuery`, `SelectedTab`, `SelectedPanel`, `ToggledDrawer`, `ToggledTheme`, `StartedRun`, `RevealedResult`, `ScrubbedTo`, `Resumed`, `ClearedHistory`, `DispatchedIntoPreview`). The preview's own Messages are the *inner* component's Message type and must stay distinct from the lab's — the lab folds them through the inner `update` and never interprets them.

## Props (tweakables)

| prop | editor | default |
| --- | --- | --- |
| `theme` | enum `dark` / `light` | `dark` |
| `canvasMode` | enum `report-first` / `source-first` | `report-first` |
| `showAgentPanel` | boolean | `true` |

`showAgentPanel: false` removes the Agent (MCP) drawer tab entirely.

## Design tokens

Two themes, same keys. Accent, status, and diff colours are in oklch so they stay perceptually matched across both.

### Light

| token | value |
| --- | --- |
| `--bg` | `#f8f7fb` |
| `--panel` | `#ffffff` |
| `--sunken` | `#f2f1f6` |
| `--ink` | `#0B0C0E` |
| `--ink-2` | `#5c5a63` |
| `--ink-3` | `#8b8891` |
| `--line` | `#e4e2ea` |
| `--sel` | `#ecebf3` |
| `--sel-hover` | `#f4f3f8` |
| `--sel-text` | `#e3e0f2` |
| `--accent` | `oklch(0.52 0.14 285)` |
| `--pass` | `oklch(0.52 0.11 155)` |
| `--fail` | `oklch(0.53 0.17 25)` |
| `--pass-bg` | `oklch(0.96 0.03 155)` |
| `--fail-bg` | `oklch(0.96 0.03 25)` |
| `--fail-line` | `oklch(0.88 0.06 25)` |
| `--diff` | `oklch(0.62 0.12 235)` |

### Dark

| token | value |
| --- | --- |
| `--bg` | `#1e1c21` |
| `--panel` | `#26242b` |
| `--sunken` | `#1a181d` |
| `--ink` | `#FAFAFA` |
| `--ink-2` | `#a7a3ae` |
| `--ink-3` | `#7a7683` |
| `--line` | `#34313a` |
| `--sel` | `#332f3d` |
| `--sel-hover` | `#2c2a33` |
| `--sel-text` | `#413b54` |
| `--accent` | `oklch(0.76 0.11 285)` |
| `--pass` | `oklch(0.76 0.13 155)` |
| `--fail` | `oklch(0.71 0.16 25)` |
| `--pass-bg` | `oklch(0.28 0.04 155)` |
| `--fail-bg` | `oklch(0.29 0.05 25)` |
| `--fail-line` | `oklch(0.40 0.08 25)` |
| `--diff` | `oklch(0.76 0.11 235)` |

`#0B0C0E` / `#FAFAFA` are the brand's ink pair from `docs/brand/README.md`. `#f8f7fb` / `#1e1c21` are the docs site's `theme-color` values.

### Typography

Two families, no others.

- **Outfit** — all UI chrome. Weights 300/400/500/600/700. Sizes in use: 15px (brand), 13.5px, 13px, 12.5px, 12px, 11px, 10.5px.
- **JetBrains Mono** — every identifier, path, assertion, count, and code block. Weights 400/500/700. Sizes: 52px (the count), 24px, 22px, 19px, 13.5px, 13px, 12.5px, 12px, 11.5px, 11px, 10.5px, 10px, 9.5px.

Loaded from Google Fonts in the prototype with `preconnect`. In production, self-host and match the weights.

Section headings are 11px/600 uppercase with `letter-spacing: 0.07em` (canvas) or `0.06em` / `0.05em` (drawer, tables). Large monospace headings carry negative tracking: `-0.015em` at 22px, `-0.03em` at 52px.

### Other scales

- Radii: 4px (badge) · 5px (chip, small button) · 6px (input, button, pill) · 8px (pre) · 9px (card, table) · 10px (preview card) · `9999px` (scrubber).
- Borders: 1px `--line` everywhere; 2px for the active tab underline and the failed-file left edge.
- Spacing: 4 · 5 · 6 · 7 · 8 · 9 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 26 · 28 · 30 · 32 · 34 · 38 · 40.
- No shadows anywhere. Depth comes from `--panel` / `--sunken` against `--bg`, and hairlines.
- Keyframes: `fc-spin` (`to { transform: rotate(360deg) }`), `fc-in` (opacity 0 → 1, used at `0.18s ease`).
- `::selection` background is `--sel-text`.

## Assets

From `docs/brand/` in `tao-io/foldcase`, copied into this bundle:

| file | use |
| --- | --- |
| `mark.svg` | header logo and the no-view empty state, applied as a CSS mask so ink colour follows the theme |
| `mark-inverse.svg`, `lockup.svg`, `lockup-inverse.svg`, `favicon.svg` | not used by this screen; included for the app shell and favicon |

No other imagery. No icon library — the few glyphs are literal characters: `▾ ▸ ✓ ✗ · ☾ ☀ ⌄ ⌃ ‹ › →`. Consider replacing these with the codebase's icon set if it has one; the arrows and carets especially.

## Fixture data

The prototype's `CATALOG` mirrors `examples/counter` in `tao-io/foldcase`: `src/counter.showcase.ts` (4 Stories, 2 Scenes), `src/tasks.showcase.ts` (4 Stories, one failing on `tasks/adds-in-order` with a real `AssertionError` and stack), and a synthetic `src/ui/picker.showcase.ts` that fails to load with `ERR_MODULE_NOT_FOUND` — the type-only-import mistake the README calls out. Schemas in the Docs tab come from `examples/counter/docs/counter.md` and `tasks.md`.

Keep the failing showcase and the failing file in whatever fixture the real lab ships with. Both failure states are load-bearing design, and a catalog that only ever renders green hides them.

## Files

| file | what it is |
| --- | --- |
| `foldcase-lab-prototype.html` | the prototype, self-contained — open in any browser, offline, fully interactive |
| `Foldcase Lab.dc.html` | the same prototype in authoring form; needs the prototyping runtime, kept for diffing |
| `docs/brand/*.svg` | brand assets listed above |
| `github.md` | which upstream files each screen was built from |

Everything above lives under `proto/` in the design project, and belongs under `proto/` in the repo. Paths inside the files are relative to that folder, so the bundle moves as a unit.
