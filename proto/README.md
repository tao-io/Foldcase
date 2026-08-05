# Handoff: Foldcase — the catalog explorer

## What this is

`foldcase` is a headless CLI and MCP server. This handoff specifies the browser UI it grows: a local explorer over a Showcase catalog, in the shape Storybook made familiar — sidebar tree, canvas, addon drawer — but built on what a Foldcase catalog actually carries.

There is no upstream GUI to match. Everything below is the design, stated as values.

The word "Lab" appears nowhere in the UI. Foldcase is the lab.

## The two files, and which one wins

| file | what it is |
| --- | --- |
| `README.md` | **the specification.** Every number is here. Where this file and the prototype disagree, this file wins. |
| `foldcase-lab-prototype.html` | the prototype, self-contained: no build, no server, no sibling files. Open it in any browser, offline, and click through it. Use it to see and feel what the numbers add up to. |
| `Foldcase Lab.dc.html` | the same prototype in authoring form. Needs the prototyping runtime; kept for diffing. |
| `spike-foldkit-cdn.html` | a probe, not design. Loads Foldkit 0.138.0 from esm.sh with no build step and reports what the HTML builder offers. Open it to reproduce the runtime findings below. |
| `docs/brand/*.svg` | the brand assets the UI uses. |

Do not port the prototype's markup. Its styling is inline `style="…"` strings on React elements, ordered for streaming render; its state is one class with a `renderVals()` method. Both are properties of the prototyping tool. Foldkit's Model/Message/update/view is a different decomposition, and Foldkit **cannot take inline styles at all** (see *Runtime facts*). Read the design here; build it the way the codebase builds things.

## Fidelity: high

Colours, type, spacing and interaction states are final and exact. Rebuild pixel-for-pixel.

One thing is deliberately not final: the live preview mounts one component (`button`) because that is the only component source the prototype carries. The real explorer mounts whatever the catalog gives it.

---

# Part 1 — Runtime facts you need before you start

All four verified by running Foldkit 0.138.0 in a browser. They change what is buildable, so read them first.

**1. The HTML builder has no `Style` attribute.** It exposes `Key`, `Class`, `Id`, `Title`, `Lang`, `Dir`, `Tabindex`, `Hidden`, every `On*` handler, and the full HTML attribute set. Passing a style string crashes the application with `Failed to set an indexed property [0] on 'CSSStyleDeclaration'`. Every value in Part 3 must therefore land as **classes** — Tailwind utilities if the explorer follows `examples/counter`, or whatever class layer you choose. The token tables are written to be read as a theme.

**2. `Runtime.makeApplication` owns its container.** It replaces the node it is given. The shell's chrome cannot share a node with a mounted preview.

**3. `update` runs on an Effect fiber.** The Model lands a tick after the event, not synchronously. Anything reading state straight after a dispatch must wait a frame.

**4. The preview needs its own document.** Two independent reasons: a shell that re-renders on every dispatch wipes an in-tree mount, and a mounted component's stylesheet must not reach the shell. The prototype mounts the preview in an `<iframe srcdoc>` positioned over a placeholder in the card, and relays dispatches to the shell by `postMessage`. Use an iframe, a shadow root, or a separate Foldkit element — but isolate it.

`Runtime` also exports `makeElement` and `embed` for embedded mounts; `makeApplication` inside a body-level container is what the prototype proved works.

---

# Part 2 — The data the UI is allowed to show

From `proto/catalog.json`, the gallery run: **24 components, 146 entries, `failures: []`**. Every entry carries exactly six fields:

```json
{
  "id": "calendar/opens-on-the-month-of-today",
  "component": "calendar",
  "file": "/tmp/foldcase-lab-gallery/src/ui/calendar.showcase.ts",
  "hasMount": true,
  "hasMessageSchema": true,
  "hasModelSchema": true
}
```

Grouping in the listing is `catalog.components[] → { component, entries[] }`. The run also reports `entry: { path, status }` — the gallery entry file it writes.

## What the catalog does not carry

An earlier draft of this design leaned on all of these. None exist. Do not invent them, and do not render a neutral placeholder that reads as a value.

| field | reality |
| --- | --- |
| `status` | Absent from the listing. Pass and fail belong to a run the explorer triggers — so **no status dots in the tree**. |
| `error` | `failures: []`; every file loaded. Failure states live in the run report. |
| `kind` (Story / Scene) | No field, and no gallery file uses Scene. All 146 are Stories, so a badge would say nothing. |
| `dispatches` | 0 of 146 declare it; 2 of 24 files mention the option. A gap list would be empty by default, which reads as "covered" when it means "unknown". |
| `duration` | Not a field on `ShowcaseReport`. |
| `lines` / `functions` | Coverage collected nothing: `files: []` on every showcase. |
| "exports a view" | No such field. `hasMount` is the closest and is `true` for all 146. |
| per-component schema | One Message union for the whole catalog: 24 calls returned the same 45,759-byte document. |

The UI surfaces this rather than hiding it — see the **Not in the data** drawer panel, which lists these eight rows verbatim, and the **Schema** tab, which states the one-union problem in place of a fake per-component table.

---

# Part 3 — The screen, value by value

## Global

**Fonts.** Two families, nothing else.

- **Outfit** — all UI chrome. Weights 300/400/500/600/700.
- **JetBrains Mono** — every identifier, path, count, number and code block. Weights 400/500/700.

Base: `font-size: 14px`, family Outfit, `-webkit-font-smoothing: antialiased`, `box-sizing: border-box` on everything, zero body margin.

**Tokens.** Two themes, same keys. Status, accent and diff colours are oklch so both themes stay perceptually matched.

| token | dark | light |
| --- | --- | --- |
| `--bg` | `#1e1c21` | `#f8f7fb` |
| `--panel` | `#26242b` | `#ffffff` |
| `--sunken` | `#1a181d` | `#f2f1f6` |
| `--ink` | `#FAFAFA` | `#0B0C0E` |
| `--ink-2` | `#a7a3ae` | `#5c5a63` |
| `--ink-3` | `#7a7683` | `#8b8891` |
| `--line` | `#34313a` | `#e4e2ea` |
| `--sel` | `#332f3d` | `#ecebf3` |
| `--sel-hover` | `#2c2a33` | `#f4f3f8` |
| `--sel-text` | `#413b54` | `#e3e0f2` |
| `--accent` | `oklch(0.76 0.11 285)` | `oklch(0.52 0.14 285)` |
| `--pass` | `oklch(0.76 0.13 155)` | `oklch(0.52 0.11 155)` |
| `--fail` | `oklch(0.71 0.16 25)` | `oklch(0.53 0.17 25)` |
| `--pass-bg` | `oklch(0.28 0.04 155)` | `oklch(0.96 0.03 155)` |
| `--fail-bg` | `oklch(0.29 0.05 25)` | `oklch(0.96 0.03 25)` |
| `--fail-line` | `oklch(0.40 0.08 25)` | `oklch(0.88 0.06 25)` |
| `--diff` | `oklch(0.76 0.11 235)` | `oklch(0.62 0.12 235)` |

`#0B0C0E` / `#FAFAFA` are the brand ink pair from `docs/brand/README.md`. `#1e1c21` / `#f8f7fb` are the docs site's `theme-color` values. Default theme is **dark**.

**Radii:** 4px badge · 5px chip and small button · 6px input, button, pill · 9px card and table · 10px preview card · `9999px` scrubber.

**Borders:** 1px `--line` everywhere. 2px only for the active tab underline.

**Spacing scale in use:** 4 5 6 7 8 9 10 11 12 14 15 16 17 18 20 22 24 26 28 30 32 34 40.

**No shadows anywhere.** Depth comes from `--panel` / `--sunken` against `--bg`, plus hairlines.

**Motion.** Two keyframes only: `fc-spin` (`to { transform: rotate(360deg) }`, used at `0.7s linear infinite`) and `fc-in` (opacity 0→1, used at `0.18s ease` on the canvas body so switching selection cross-fades).

**Links.** `a { color: var(--accent) }`, `a:hover { color: var(--ink); text-decoration: underline }`. `::selection { background: var(--sel-text) }`.

## Shell geometry

`height: 100vh`, column, `background: --bg`, `color: --ink`. No page scroll.

```
┌─ header  52px ────────────────────────────────────────────┐
├─ body  flex:1, min-height:0 ──────────────────────────────┤
│ ┌ sidebar 292px ┐ ┌ main  flex:1, min-width:0 ──────────┐ │
│ │               │ │ tab bar 40px                        │ │
│ │               │ │ canvas  flex:1, min-height:0, auto  │ │
│ │               │ │ drawer  36px + min(222px, 30vh)     │ │
│ └───────────────┘ └─────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

Every scroll region needs `min-height: 0` on its flex parent. This is the single most common way to get this layout wrong.

## Header — 52px

`flex: none; display: flex; align-items: center; gap: 14px; padding: 0 14px; border-bottom: 1px solid --line; background: --panel`.

1. **Brand**, `gap: 9px`: the mark at 22×22 — `background-color: --ink` masked by `docs/brand/mark.svg` (`center / contain no-repeat`, set both `mask` and `-webkit-mask`), so one file serves both themes. Then "Foldcase" at 15px/700, `letter-spacing: -0.01em`. Nothing beside it.
2. **Spacer**, `flex: 1`.
3. **Runtime pill**: `padding: 4px 9px; border: 1px solid --line; border-radius: 5px; background: --sunken`, JetBrains Mono 11.5px. Text and colour by state — `loading foldkit…` in `--ink-3`, `foldkit 0.138.0 · mounted` in `--pass`, `foldkit unavailable` in `--fail`.
4. **Reload catalog** — the primary button: `height: 30px; padding: 0 12px; border: 1px solid --ink; border-radius: 6px; background: --ink; color: --bg`, 12.5px/600, `gap: 7px`, hover `opacity: 0.85`. Maps to `foldcase_load_catalog`. While loading, the label becomes "Loading" and an 11px spinner precedes it: `1.5px solid currentColor`, `border-top-color: transparent`, circle, `fc-spin`. Idle, the spinner element is `display: none` — not removed.
5. **Theme toggle** — 30×30, centred glyph `☾` (dark) / `☀` (light), `border: 1px solid --line; border-radius: 6px; background: --panel; color: --ink-2`, 13px; hover `color: --ink; border-color: --ink-3`.

The header holds nothing else. Two elements were removed on review and must not return: a `FOLDCASE_SHOWCASE_DIR` path chip, and a `report-first` / `source-first` segmented toggle.

## Sidebar — 292px

`flex: none`, column, `border-right: 1px solid --line; background: --panel`.

**Search.** In a `padding: 10px` box with `border-bottom: 1px solid --line`. Input: full width, `height: 30px; padding: 0 10px; border: 1px solid --line; border-radius: 6px; background: --sunken; color: --ink`, 12.5px, `outline: none`, focus `border-color: --ink-3`. Placeholder `Find a showcase`. Filters on every keystroke: case-insensitive substring against the full id. A component group survives if it has matching entries or its own name matches. While a query is active every matching group is forced open.

**Summary strip.** `padding: 9px 12px; border-bottom: 1px solid --line`, JetBrains Mono 11px, `gap: 10px`: `146 showcases` in `--ink-2`, spacer, `24 components` in `--ink-3`.

**Tree.** `flex: 1; overflow: auto; padding: 6px 0 16px`. Two levels: **component → state**. No file level — 146 entries across 24 files make the path noise, and the file is on the entry.

- *Component row* — full-width button, `padding: 6px 12px; gap: 8px`, transparent, `color: --ink`, Outfit 12.5px/600, left-aligned, hover `color: --accent`. Caret `▾`/`▸` in an 8px slot at 9px `--ink-3`. Name truncates with ellipsis. Trailing visible count in JetBrains Mono 10px/400 `--ink-3`. Default state: collapsed, except the component holding the initial selection.
- *State row* — full-width button, `padding: 5px 12px 5px 28px; gap: 9px`, Outfit 12.5px, `line-height: 1.35`, `align-items: flex-start` (long names wrap to two lines and must stay legible). Label is the id minus its `component/` prefix. Selected: `background: --sel; color: --ink`. Otherwise transparent, `--ink-2`, hover `background: --sel-hover`.
- *Row mark* — a 6px dot, `margin-top: 5px`, `flex: none`. Filled `--accent` when the entry can be mounted live; otherwise a hollow `1px solid --ink-3` ring. **This is not a status dot.** It says "mountable here", and the catalog carries no pass/fail.
- *LIVE tag* — on mountable rows only, right-aligned, JetBrains Mono 9px, `letter-spacing: 0.05em`, `--accent`, `margin-top: 1px`.

**Footer.** `flex: none; padding: 9px 12px; border-top: 1px solid --line`, JetBrains Mono 10.5px, `line-height: 1.55`, `--ink-3`: `foldcase_load_catalog · no run yet, so no status`.

## Canvas tab bar — 40px

`flex: none; padding: 0 12px; border-bottom: 1px solid --line; background: --panel`, tabs stretched full height.

Four tabs: **Canvas** · **Entry** · **Timeline** · **Schema**. Each `padding: 0 12px`, `border-bottom: 2px solid` (`--ink` active, `transparent` otherwise), Outfit 12.5px/500, `--ink` active / `--ink-3` otherwise, hover `--ink`. Default is Canvas.

Right-aligned after a spacer: the selected entry's file path, relative to the catalog root, JetBrains Mono 11px `--ink-3`.

The canvas body: `flex: 1; min-height: 0; overflow: auto; animation: fc-in 0.18s ease`.

## Canvas tab — the mounted component

The reason the UI exists. Column, `min-height: 100%`.

**Toolbar** — `flex: none; padding: 9px 20px; border-bottom: 1px solid --line; background: --panel; gap: 10px`. Left: JetBrains Mono 11px `--ink-3`, reading `mounted { update, view } · foldkit from esm.sh` when the mount is verified, `hasMount: true` otherwise. Spacer. Right, only when mounted: a **remount** button — `height: 24px; padding: 0 9px; border: 1px solid --line; border-radius: 5px; background: --panel; color: --ink-2`, 11px, hover `--ink`.

**Body** — a row, `flex: 1; min-height: 0`: preview surface + timeline pane.

### Preview surface

`flex: 1; min-width: 0; min-height: 280px; overflow: auto; padding: 24px; background: --sunken`, `display: flex; align-items: flex-start; justify-content: center`.

The card: `width: 100%; max-width: 520px; margin: auto` (auto margins centre it while both overflow directions stay scrollable), `border: 1px solid --line; border-radius: 10px; background: --panel; overflow: hidden`. Three bands:

1. **Title bar** — `padding: 7px 12px; border-bottom: 1px solid --line`, JetBrains Mono 11px `--ink-3`, `gap: 8px`: a 6px dot (`--pass` when mounted, `--ink-3` otherwise) then the live document title, e.g. `button — 2 clicks`.
2. **The mount** — a `height: 186px` region when the selection is mountable, `height: 0` otherwise. The component renders here, in its own document (Runtime fact 4).
3. **Model bar** — mounted only. `padding: 9px 12px; border-top: 1px solid --line; background: --sunken`, JetBrains Mono 11.5px `--ink-2`, `gap: 10px`: the label `model` in `--ink-3`, then the serialized Model, e.g. `{ clicks: 2 }`.

**Component styling inside the mount** (the prototype's `button`, for reference — the real explorer inherits whatever the catalog component brings): column, centred, `gap: 18px`, `padding: 30px 28px`. Count in JetBrains Mono 44px/500, `line-height: 1`, `letter-spacing: -0.03em`, `--ink`. Button `min-width: 44px; height: 34px; padding: 0 16px; border: 1px solid --line; border-radius: 6px; background: --bg; color: --ink`, 13px, hover `border-color: --ink-3`. Caption 12.5px `--ink-3`.

**Not-mountable state.** When the selection has no source the explorer can mount, the card body is `padding: 40px 30px`, centred, JetBrains Mono 12px, `line-height: 1.75`, `--ink-3`, `text-wrap: pretty`, naming the component and saying plainly that this prototype does not carry it. Do not draw a fake component.

### Timeline pane — 308px

`flex: none`, column, `border-left: 1px solid --line; background: --panel`. This is Foldkit's own devtools overlay vocabulary (`foldkit/foldkit`, `packages/devtools/src/overlay.ts`) — if those styles are importable, import them rather than restating them.

**Header** — `padding: 6px 10px; border-bottom: 1px solid --line; justify-content: space-between; gap: 8px`. Left: a 6px dot plus `Live` in `--pass` when mounted, `Idle` in `--ink-3` otherwise, JetBrains Mono 12px. Right: `Clear history` — borderless, JetBrains Mono 12px `--ink-3`, hover `--ink`.

**Message list** — `flex: 1; min-height: 0; overflow: auto`. One row per real dispatch: `padding: 4px 6px; border-bottom: 1px solid --line; gap: 6px`. Columns:

- index — `min-width: 20px`, JetBrains Mono 10px `--ink-3`, zero-padded to three digits (`001`).
- diff dot — 5px circle in `--diff`. The element keeps its 5px even when it carries no colour, so rows stay aligned.
- tag — `flex: 1`, truncating, JetBrains Mono 11.5px `--ink-2`, rendered as the constructor call: `Clicked()`, `ChangedStep({ step: 10 })`.
- delta — JetBrains Mono 10px `--ink-3`, `+Nms`, measured between dispatches.

Empty state: `padding: 14px 12px`, JetBrains Mono 11px, `line-height: 1.75`, `--ink-3`. Mounted: "Nothing dispatched yet. Click the component — each Message that reaches update lands here." Not mounted: "The trail records real dispatches, so it fills only while a component is mounted."

**Scrubber footer** — `flex: none; height: 33px; border-top: 1px solid --line`. Track: `flex: 1`, 16px hit area, `padding: 0 7px`; inside, a 4px `9999px` bar in `--line` with a fill in `--accent`. Readout: `width: 72px; padding-left: 12px; border-left: 1px solid --line`, centred, JetBrains Mono 10px `--ink-3`, `003 / 003`, both sides zero-padded to three.

Time travel is out of scope for a live mount: replaying means re-running the real `update` from the initial Model, which the catalog does not expose per state. The scrubber reads position; do not wire it to a fake rewind.

## Entry tab

`padding: 26px 32px 34px; max-width: 900px`. This is the whole listing entry, said plainly.

1. Status row, `gap: 12px; margin-bottom: 14px`: a neutral pill reading `listed` — `padding: 4px 10px; border-radius: 6px; background: --sunken; color: --ink-2`, JetBrains Mono 11.5px/600 — then `foldcase_list_showcases — the catalog reports no status until a run` in JetBrains Mono 11px `--ink-3`.
2. The id as `h1`: JetBrains Mono 22px/500, `letter-spacing: -0.015em`, `word-break: break-word`, `margin: 0 0 20px`.
3. **Facts grid**: `display: grid; grid-template-columns: 1fr 1fr; gap: 1px`, `border: 1px solid --line; border-radius: 9px; overflow: hidden`, `background: --line` so the 1px gaps read as hairlines. Six cells, `padding: 11px 15px; background: --panel`: label in Outfit 10.5px/600, `letter-spacing: 0.06em`, uppercase, `--ink-3`, `margin-bottom: 4px`; value in JetBrains Mono 12.5px, `word-break: break-word`. The three booleans are `true` in `--pass`; `component` and `state` in `--ink`; `file` in `--ink-2`.
4. Closing note: `padding: 14px 16px; border: 1px solid --line; border-radius: 9px; background: --panel`, Outfit 12.5px, `line-height: 1.65`, `--ink-2`, `text-wrap: pretty` — that these six fields are the whole entry, and anything else is reachable only by running the showcase.

## Timeline tab

`padding: 26px 32px 34px; max-width: 860px`. Opens with Outfit 13px, `line-height: 1.65`, `--ink-2`, `margin-bottom: 20px`: that a play is an opaque thunk the runner never looks inside, that the listing carries no trace of one, and that what *can* be recorded is a live mount.

Empty state: `padding: 20px; border: 1px dashed --line; border-radius: 9px`, JetBrains Mono 12px, `line-height: 1.75`, `--ink-3`.

Each entry: `display: grid; grid-template-columns: 18px 1fr; gap: 16px`. Left column: a 9px dot in `--accent`, `margin-top: 5px`, then a 1px `--line` rule filling the remaining height. Right column, `padding-bottom: 20px`: kind in JetBrains Mono 10.5px/600, `letter-spacing: 0.05em`, `--accent`, `margin-bottom: 4px`; the Message in JetBrains Mono 13.5px `--ink`, `margin-bottom: 5px`, `word-break: break-word`; the detail in JetBrains Mono 12px `--ink-3`.

## Schema tab

`padding: 28px 32px 40px; max-width: 820px`. The one-union problem, stated rather than papered over.

1. Top row, `gap: 12px; margin-bottom: 18px`: a chip reading `foldcase_get_showcase_schema` — `padding: 3px 8px; border: 1px solid --line; border-radius: 5px; background: --panel`, JetBrains Mono 11px `--ink-2` — spacer, then `catalog-wide, not per component` in JetBrains Mono 11px **`--fail`**.
2. Component name as `h1`: JetBrains Mono 20px/500, `margin: 0 0 12px`.
3. **Warning block**: `padding: 15px 17px; border: 1px solid --fail-line; border-radius: 9px; background: --fail-bg`, Outfit 12.5px, `line-height: 1.7`, `--ink`, `text-wrap: pretty`. States that one Message union covers the whole catalog, that `button` and `calendar` returned the same 45,759-byte document, and that a per-component table would be the same table 24 times over.
4. **Facts list**: `border: 1px solid --line; border-radius: 9px; overflow: hidden`, `background: --line`, `gap: 1px`. Rows `display: grid; grid-template-columns: 230px 1fr; gap: 16px; padding: 11px 15px; background: --panel`, JetBrains Mono 12px — label `--ink-2`, value coloured by meaning: `hasMessageSchema: true` and `hasModelSchema: true` in `--pass`; `distinct documents: 1 across 24 components` in `--fail`; `document size: 45,759 bytes` in `--ink-2`.

When the catalog splits its unions per component, this tab becomes the Message and Model tables — `grid-template-columns: 1.3fr 1fr 1.4fr` for Messages (Message · Field · Type) and `1fr 1.4fr` for the Model (Field · Type), header row `padding: 9px 14px; background: --sunken`, Outfit 11px/600 uppercase `letter-spacing: 0.05em` `--ink-3`; body rows `padding: 10px 14px; border-bottom: 1px solid --line`, JetBrains Mono 12px, first cell `--ink`, rest `--ink-2`.

## Addon drawer

`flex: none; border-top: 1px solid --line; background: --panel`, pinned to the bottom of main.

**Tab strip** — `height: 36px; padding: 0 12px; border-bottom: 1px solid --line`. Four tabs, each `padding: 0 11px; gap: 6px; border-bottom: 2px solid` (`--ink` active / transparent), Outfit 12px/500, `--ink` active / `--ink-3` otherwise, hover `--ink`:

- **Runtime**
- **Not in the data**, badge `8` — badge `padding: 1px 5px; border-radius: 4px`, JetBrains Mono 10px, on `--fail-bg` in `--fail` (this badge is a warning, not a count)
- **Agent (MCP)**, badge `6` on `--sunken` in `--ink-3`
- **JSON**

Far right: a collapse toggle, `padding: 0 8px`, borderless, 14px `--ink-3`, hover `--ink`, glyph `⌄` open / `⌃` collapsed.

**Body** — `height: min(222px, 30vh); overflow: auto; padding: 16px 20px 22px`. The `min()` matters: on a short viewport the drawer yields rather than starving the canvas.

- **Runtime** — an intro at Outfit 12.5px/1.65 `--ink-2`, then rows `display: grid; grid-template-columns: 220px 1fr; gap: 16px; padding: 8px 0; border-top: 1px solid --line`: label in JetBrains Mono 12px coloured by meaning (`--pass` resolved, `--fail` for the constraint, `--ink-2` neutral), value in Outfit 12.5px/1.5 `--ink-2`. Content is the four runtime facts from Part 1 plus the resolved versions.
- **Not in the data** — intro, then rows `grid-template-columns: 200px 1fr`: field in JetBrains Mono 12px `--ink`, reality in Outfit 12.5px/1.5 `--ink-2`. Exactly the eight rows in Part 2.
- **Agent (MCP)** — intro naming `readOnlyHint: true`, then six rows `grid-template-columns: 280px 1fr`: tool name in JetBrains Mono 12px `--ink`, description in Outfit 12.5px/1.5 `--ink-2`. Tools: `foldcase_list_showcases`, `foldcase_get_showcase_schema`, `foldcase_get_showcase_model_schema`, `foldcase_run_showcase`, `foldcase_run_catalog`, `foldcase_load_catalog`. Copy for each is in the prototype's `TOOLS` array — reuse it verbatim.
- **JSON** — one `<pre>`, JetBrains Mono 12px/1.7 `--ink-2`, `white-space: pre-wrap`: the selected entry exactly as the listing carries it, `JSON.stringify(…, null, 2)`, followed by the catalog totals.

---

# Part 4 — Behaviour

**Selection.** Clicking a state row selects it and resets the preview: dispatch trail cleared, mount returned to its initial Model.

**Component expand/collapse.** Per component, default collapsed except the one holding the initial selection. A search query overrides and opens every matching group.

**Reload catalog.** Idempotent while running: spinner plus "Loading" for the duration, then back. Maps to `foldcase_load_catalog`; the tree rebuilds from the response. Nothing about statuses changes, because the listing has none.

**Live dispatch.** Every interaction inside the mount is a real Message through the real `update`. Each one appends a row to the trail with a measured `+Nms` delta and updates the Model bar and the card title. The shell must not interpret those Messages — they are the mounted component's type, not the explorer's.

**Remount.** Rebuilds the preview document from scratch: Model back to `init`, trail cleared.

**Theme.** Toggling swaps the whole token set, including inside the preview document — the mount must be re-skinned, not left on stale colours. The prototype rebuilds the frame, which also resets the mount; production should push the theme in instead and keep the Model.

**Drawer collapse.** Hides the body, keeps the 36px strip.

**Persistence.** The prototype persists nothing. Production should keep theme, selection, open groups and drawer state, so a reload lands where you left off.

# Part 5 — State, in Foldkit terms

One Model for the shell:

| field | type | notes |
| --- | --- | --- |
| `theme` | `'dark' \| 'light'` | default `dark` |
| `selected` | showcase id | `component/state` |
| `tab` | `'canvas' \| 'entry' \| 'timeline' \| 'schema'` | default `canvas` |
| `panel` | `'runtime' \| 'absent' \| 'agent' \| 'json'` | default `runtime` |
| `drawerOpen` | boolean | default true |
| `open` | set of component names | absent means collapsed |
| `query` | string | |
| `reloading` | boolean | |
| `mounted` | boolean | **derived from a verified paint**, never from "the module loaded" |
| `trail` | array of `{ tag, delta }` | real dispatches, relayed from the preview document |

Messages: `SelectedShowcase`, `ToggledComponent`, `ChangedQuery`, `SelectedTab`, `SelectedPanel`, `ToggledDrawer`, `ToggledTheme`, `ReloadedCatalog`, `CatalogArrived`, `PreviewMounted`, `PreviewFailed`, `PreviewDispatched`, `ClearedHistory`, `Remounted`.

`PreviewMounted` / `PreviewFailed` are load-bearing. `Runtime.run` returns `undefined` and throws nothing when a mount paints nothing, so a mount that is assumed to have worked will silently show an empty card while the UI claims "Live". Verify the container has children after a tick, and let the failure surface.

# Part 6 — Tweakables

| prop | editor | default | effect |
| --- | --- | --- | --- |
| `theme` | enum `dark` / `light` | `dark` | whole token set, shell and preview |
| `showAgentPanel` | boolean | `true` | removes the Agent (MCP) drawer tab entirely |

# Part 7 — Assets

From `docs/brand/` in `tao-io/foldcase`:

| file | use |
| --- | --- |
| `mark.svg` | header logo and the not-mountable empty state, applied as a CSS mask so ink follows the theme |
| `mark-inverse.svg`, `lockup.svg`, `lockup-inverse.svg`, `favicon.svg` | not used by this screen; included for the app shell and favicon |

No other imagery, no icon library. The glyphs are literal characters: `▾ ▸ ☾ ☀ ⌄ ⌃ →`. Swap them for the codebase's icon set if it has one — the carets especially.

# Part 8 — Pixel-perfect checklist

Work through this against the standalone prototype, both themes:

- [ ] Header is exactly 52px; tab bar 40px; drawer strip 36px; sidebar 292px; timeline pane 308px.
- [ ] Every scroll region scrolls, and the shell itself never does. Sidebar and canvas scroll independently; the drawer caps at `min(222px, 30vh)`.
- [ ] Fonts: no UI chrome in JetBrains Mono, no identifier or number in Outfit.
- [ ] Both themes: no hard-coded hex outside the token table; oklch values kept as oklch.
- [ ] No shadows. No border wider than 1px except the 2px active tab underline.
- [ ] Facts grid and Schema facts show hairline gaps, not doubled borders — the `background: --line` + `gap: 1px` trick.
- [ ] Long state names wrap to two lines in the sidebar and stay aligned with their dot.
- [ ] The sidebar mark is never green or red. It means mountable, not passing.
- [ ] Nothing in the UI claims a status, duration, coverage number or Story/Scene kind.
- [ ] "Live" appears only after a verified paint; a silent mount failure shows the failure.
- [ ] The mounted component's stylesheet does not reach the shell: mount something with `body { background: red }` and confirm the shell is untouched.
- [ ] Clicking inside the mount adds exactly one trail row per dispatch, with a measured delta.
- [ ] Theme toggle re-skins the preview too.
- [ ] Focus is visible on every control by keyboard: the search input's `border-color: --ink-3` at minimum.
- [ ] Hit targets in the mount are at least 44px wide.
- [ ] The word "Lab" appears nowhere.
