# Foldcase — AI-native roadmap: what to borrow from Storybook, and Foldcase's moat

Research synthesis (2026-07). Four questions: (1) who else is building AI-native component
labs, (2) what Storybook does that's worth stealing, (3) what Foldkit's Scene/Story/DevTools
give us that React can't, (4) what Foldcase actually has vs needs. Grounded in web research +
reads of `packages/openstory/src`, the Foldkit checkout (`/Users/tao/CosmOS/.repos/foldkit`),
and the Bina pilot's Story/Showcase/Scene pyramid.

---

## TL;DR

The market has converged on **one winning pattern and Storybook owns it**: an **MCP server that
exposes machine-readable component context + a self-healing `write → preview → test → fix` agent
loop**, guarded by **per-story visual snapshots**. Every serious player (Storybook 10.3+, Chromatic,
Applitools, even MCP-UI/MCP-Apps as a protocol) is a variation on it.

**Foldcase's moat is the loop, but _typed and deterministic_.** Storybook's loop pokes the DOM and
reads untyped `fn()` callbacks. Foldkit gives Foldcase what React structurally cannot: a **single
serializable `Model`**, a **typed, Effect-Schema-introspectable `Message` union**, a **pure
`update`**, and **time-travel/replay**. An agent can read the exact app state, introspect the
message schema, dispatch a *valid typed message by construction*, and assert on the deterministic
Model delta — no DOM guessing, no flakiness. The `foldkit-devtools` MCP (14 tools) already ships
this. **Foldcase should build the self-healing test loop on top of it and stop chasing Storybook's
addon breadth.**

The gap: Foldcase today is a thin CSF catalog + iframe + in-browser `play()` runner. Its **own MCP
is a one-line stub** (`mcp/index.ts` = `MCP_PLACEHOLDER = true`), the Foldkit overlay/relay are
*consumer-wired* not owned, Controls are shallow and **remount on every arg change (discarding the
TEA Model)**, and there is no CI test-runner, a11y, docs, actions panel, or visual regression.

---

## 1. Landscape — who's building AI-native component labs (2025–2026)

| Tool | What it is | AI-native angle | Best idea to steal |
|---|---|---|---|
| **Storybook 10.3+** (benchmark) | The incumbent (2.5M wk dl). Official MCP server (`@storybook/addon-mcp`, `/mcp`) + Claude Code/Codex plugins; Vitest Test addon turns every story into a browser test. | **Self-healing loop:** agent writes story → previews → auto-runs interaction+a11y tests → reads failures → fixes → re-runs. MCP exposes component metadata so agents reuse, not hallucinate. | The **write→preview→test→fix loop over MCP**, backed by story-as-test. Highest leverage. Foldcase has the MCP primitives to do it *better* (typed). |
| **Openstory** (our upstream) | "Storybook for Agents", CSF-3, Vite-native, multi-framework. | Marketed agent-first, but concrete MCP wiring is thin — the gap Foldcase fills. | Lean into single-framework focus: expose deterministic Model/Msg introspection a generic tool can't. |
| **MCP-UI / MCP Apps** | Ratified Jan-2026 MCP extension: tools return interactive UI; components **emit structured events, the agent owns state**. | The protocol standard for agent-drivable UI (Claude, ChatGPT, VS Code, Goose). | The **"components emit events, agent owns state" contract maps 1:1 onto TEA** (view emits Msg, runtime owns Model). Frame Foldcase's agent API in MCP-Apps terms. |
| **Chromatic** | Storybook-native visual regression (snapshot every story/PR, TurboSnap), now "Frontend Workflow for AI". | Catches the LLM failure where code compiles + functional tests pass but pixels are wrong. | **Per-story visual snapshot as the safety net for agent-generated UI** — component-level diffs have low false-positive rates. |
| **Applitools Eyes** | AI visual diffing; Storybook addon + MCP server (10.22, Jan-2026). | Separates authoring (LLM) from execution (deterministic). Adds a third state: **"unresolved"** (needs human/LLM judgment). | The **"unresolved" third state** — don't force binary pass/fail on AI review; surface "changed, needs a decision". |
| **Ladle** | Uber's React-only Vite+SWC Storybook alt (~1.2s cold start). | Not AI-native, but **machine-readable index + Playwright-drivable by design**. | Keep the lab tiny; expose a clean programmatic story index external agents/tests can enumerate headlessly. This is the Vite-speed bar. |
| **Histoire / react-cosmos** | Lighter niche alts; no meaningful agent story. | — | react-cosmos **fixtures** (state permutations as data) + Histoire **inline docs** (intent, not just props). |

---

## 2 + 3. The borrow list, mapped onto TEA/Effect (value ÷ effort)

The structural insight: **Foldkit already contains the hard parts of Storybook's testing story.**
In React, Storybook bolts state inspection, an event log, and a step-debugger onto an opaque tree.
Foldkit hands them over for free — several "addons" collapse into thin UI over machinery that
already ships in `@foldkit/devtools` + `@foldkit/devtools-mcp`.

Two recurring "no-React" obstacles, both turn out to be *upgrades*:
- **Docgen is dead** (`react-docgen` powers Storybook's argTypes/ArgsTable). **Replace with Effect
  Schema** — already exposed as `foldkit_get_message_schema` (Msg union → JSON Schema). Runtime-
  available and precise, *better* than react-docgen.
- **Portable stories** (`composeStories`) are React/Vue-only. But a Foldkit portable Showcase is
  trivial: instantiate `{init, update, view}` headless and assert on the **Model** — no JSDOM.

| Rank | Capability | TEA mapping | Effort |
|---|---|---|---|
| 1 | **Actions → message log** | *Is* the message bus — `foldkit_list_messages` / `count_messages_by_tag` already exist; panel is live UI over them. | Easy |
| 2 | **Play + Interactions + step debugger** | `play` dispatches typed Msgs (`dispatch_message`) and asserts on Model — no DOM round-trip. **Step debugger = the time-travel you already built** (`list_keyframes`/`replay_to_keyframe`). | Medium |
| 3 | **Test-runner / stories-as-CI / portable stories** | Portable Showcase = boot `{init,update,view}` headless, run `play`, `expect(model)…`. Vite-native already; Vitest browser mode drops in. | Medium |
| 4 | **Args/Controls → live Model editor** | "Args" = the initial Model; Controls = a **Schema-driven form that edits the Model / dispatches setter Msgs** and re-renders. | Medium |
| 5 | **a11y (axe-core)** | Runs on the DOM `view` produced — renderer-blind. `axe.run(container)` after render. | Easy |
| 6 | Coverage (v8/Istanbul) | Vite-native; instrument `view`/`update`. | Easy |
| 7 | Decorators/params/globals + **Effect-Layer mocking** | Don't port MSW — "mock the network" = provide a **test `Layer`** swapping a service in the Effect runtime. Commands are resolved-by-test, not executed. | Medium–Hard |
| 8 | Autodocs / ArgsTable | Once #4's Schema inference exists, a Model/Msg **schema table is nearly free**. | Medium |
| 9 | Visual regression | Renderer-agnostic (screenshots DOM). Cheapest: Playwright `toHaveScreenshot` in the Vitest browser run. | Medium |
| 10–12 | Viewport/backgrounds/measure/outline; storysource; composition/refs | Pure DOM/CSS chrome; `?raw` imports; cross-iframe. | Easy–Med, low value |

**What Storybook _fundamentally cannot_ do (Foldcase's exclusives)** — all consequences of
*state = one serializable value* + *events = one typed union* + *pure update*:
1. Deterministic whole-app **Model snapshot at any point in history** (`get_model` / `get_model_at`).
2. **Introspectable Message Schema** (Effect Schema → JSON Schema) so an agent constructs valid
   payloads by construction (`get_message_schema`). Storybook actions are untyped callbacks.
3. **Dispatch-by-construction + assert the transition** (`dispatch_message` → `diff_models`).
4. **Exact time-travel/replay** (pure update + keyframes). React hooks/refs can't replay.
5. **Commands (effects) as inspectable, test-resolved data** — deterministic effects without MSW.
6. **Mount/subscription lifecycle as a queryable ledger.**

---

## 4. Foldcase today — HAVE / PARTIAL / MISSING

**HAVE:** CLI (dev/build/preview/list/inspect/generate), CSF-3 parsing (meta/args/argTypes/tags/
play), build-time manifest served as JSON, iframe canvas + postMessage, in-browser `play()` runner
with status reporting, args/argTypes extraction + a basic Controls UI, framework adapters
(react/foldkit/solid/vue/svelte), layout params, globals/toolbar.

**PARTIAL:** Foldkit DevTools overlay + MCP relay are **consumer-wired** (per-Showcase `devTools`
config + the user's `@foldkit/vite-plugin`), not Foldcase-owned — Foldcase's only enabling code is
the transparent `{...config}` spread in `foldkit/renderer.ts:176` and Vite auto-loading the project
`vite.config.ts`. Controls handle only bool/number/text/select (object/array/color/date/range/
conditional-`if` are read-only stubs). **Foldkit arg changes full-remount and discard the TEA
Model** (`foldkit/renderer.ts:215` → new `makeApplication`), unlike React's in-place `rerender`.

**MISSING:** Foldcase's **own** MCP server (`mcp/index.ts` = `MCP_PLACEHOLDER`, wired to nothing);
autodocs/MDX; a11y; visual regression; test-runner (stories-as-CI); coverage; actions panel;
interactions/step-debugger UI; viewport/backgrounds toolbars (typed but never rendered).

**Key seams (where to hook):**
- **Own MCP** — replace the stub; add a `foldcase mcp` subcommand (`cli/run.ts`) reading the same
  `ManifestBuilder.build()` and driving Showcases via the existing `ShellToStory` postMessage verbs.
- **Test-runner** — new `foldcase test` subcommand reusing the **boot.js play runner** headlessly
  (play loop + pass/fail already exist at `boot.ts:326`/`369`); collect `play-status` per story.
- **a11y** — at the renderer `mount()` boundary (`boot.ts:307`), run axe on `canvasElement`, post a
  new `StoryToShell` variant.
- **Actions** — the protocol already declares a `console` message never emitted (`boot/protocol.ts:28`);
  wire the dispatched-message stream to it + a shell panel.
- **Model-preserving Controls** — replace the full-remount `update` (`foldkit/renderer.ts:215`) with
  a dispatch-into-the-live-runtime path, mirroring React's in-place `rerender`.

---

## Recommendation — a phased plan

**Don't:** rewrite the shell in Foldkit (no user-visible capability — see the findings doc Q2);
port MSW (use Effect Layers); chase Storybook's full addon breadth.

### Phase 1 — the moat: the typed self-healing loop (highest leverage)
1. **`foldcase test`** — stories-as-CI. Headless play runner + a Foldkit "portable Showcase"
   (`{init,update,view}` booted headless, assert on Model). Turns every Showcase into a free CI test.
2. **Own MCP server (`foldcase mcp`)** — the *catalog* layer (list Showcases, get argTypes/Schema,
   run a Showcase's play → structured pass/fail), composing with the `foldkit-devtools` MCP (the
   *runtime* layer: dispatch/get_model/replay). Together = the agent loop: enumerate → dispatch
   typed msg → assert Model → read structured result → fix → re-run.
3. **Controls as a live Model editor via Effect Schema** — Schema-driven form that edits the Model /
   dispatches setter Msgs *in place* (fix the remount-discards-Model bug). The control *is* the typed
   message union — a capability Storybook can't match.

### Phase 2 — cheap DOM wins (renderer-agnostic, mostly Easy)
4. **a11y (axe)** panel + a11y assertions in `foldcase test`.
5. **Actions panel = the message log** (nearly free; the message stream already exists).
6. **Per-Showcase visual snapshot gate** with an **"unresolved" third state** + optional LLM-judge on
   ambiguous diffs — the safety net for agent-generated UI.

### Phase 3 — depth
7. Interactions **step-debugger** UI (wire play steps to keyframes — time-travel already exists).
8. **Autodocs** (Model/Msg **Schema table** — nearly free once Phase-1 Schema inference lands) + MDX.
9. Coverage; viewport/backgrounds toolbars.

**The pitch in one line:** *Storybook's self-healing loop pokes the DOM and reads untyped callbacks;
Foldcase's dispatches a typed message from an introspectable schema and asserts on a deterministic,
time-travellable Model. Same loop — no guessing, no flake.*

---

---

## 5. Build it on the TAO / CosmOS stack (Foldcase is our own Effect-4 Foldkit tool)

Foldcase is a **TAO-owned Effect-4 Foldkit tool**, so the moat features are built to CosmOS's
mandatory stack and gates (`/Users/tao/CosmOS/CLAUDE.md`, ADR-0001), not the fork's pnpm/vite-plus
toolchain. Keep the two layers separate:

- **Fork-core (openstory heritage)** — the CSF parser, Vite plugin, manifest, React shell, framework
  renderers. Stays **pnpm + vitest + vite-plus + turbo**, synced from upstream (`main` tracks
  millionco). **Don't TAO-ify it** — that fights the upstream-sync goal in `FORK.md`.
- **Foldcase-native moat (new code)** — the typed self-healing loop: `foldcase test`, the `foldcase
  mcp` catalog server, Schema-driven controls. **This is the "our own Effect-4 tool" part** — write
  it on the CosmOS stack and develop it as a **CosmOS tooling project under `tools/foldcase/`**,
  dogfooded against the Todoer PWA's Foldkit components (`src/pwa/`).

### The stack the new code uses (mandatory)

| Layer | Choice | Applied to Foldcase moat |
|---|---|---|
| Runtime | **Bun** (`bun build --compile`) | `foldcase test` + `foldcase mcp` ship as single binaries. |
| Logic | **Effect v4** — typed errors, **Layers** (DI), **Schema**, `Config`/`Redacted` | MCP server + test-runner are Effect programs; requests **Schema-decoded**, failures are typed errors, services wired as Layers. |
| Tests | **`bun test`**, co-located, **TDD mandatory** (`tdd` skill, red→green→refactor) | Every slice test-first through its interface. |
| Foldkit UI parts | **vite + vitest + foldkit + `@foldkit/ui`** (like `src/pwa/`) | Any in-lab Foldkit panel (Schema controls, a11y) uses foldkit's `vitest` matchers, not `bun test`. |
| Lint | **oxlint** + the three vendored plugins: `@cosmos/oxlint-plugin-effect` (ns `effect`), `@cosmos/oxlint-plugin-cosmos` (ns `cosmos`), `@cosmos/oxlint-plugin-foldkit` (Foldkit apps) | Effect-4 idiom bans enforced: **`Config` over `process.env`** (`effect/avoid-process-env`), **`Effect.log*` over `console`** (`effect/use-console-service`), **`Schema` over `JSON.parse`**. |
| Types | **patched `tsc` + `@effect/language-service`** (`prepare: effect-language-service patch`) | Effect-4 semantics gate (`typecheck` / `typecheck:foldkit`). |
| Toolchain | **mise** per repo; the **G0–G3** gate pyramid | New tasks mirror `lint` / `typecheck` / `test` / `lint:foldkit` / `typecheck:foldkit`. |
| Skills | **`effect-ts`** (any Effect), **`foldkit`** (any UI), **`tdd`** (any dev) — all mandatory | Consult before writing code; pattern-match the vendored `./.repos/foldkit`. |
| Loop | claim → work → **`mise run review --base local`** → **`cosmos finish <id>`**; branch `<id>-slug` off `local` | The moat work is a Todoer task closed via the loop; push to `local` is sanctioned, `main` opt-in. |

### How each moat deliverable maps to the stack

- **`foldcase test` (Phase 1.1)** — an **Effect program** (`@effect/platform` `Command`/child-process
  + `Layer`s) that boots each Showcase's iframe entry headlessly (reuses the fork's boot.js play
  runner), collects `play-status`, and — for Foldkit — also boots a **portable Showcase**
  (`{init,update,view}` headless) and asserts on the **Model** via Schema. Typed errors per failure
  mode; results as a `Schema`-decoded report. `bun test` TDD; ships as a bun binary + a `mise run
  foldcase:test` task. **Dogfood:** run it over `src/pwa/`'s components in G2.
- **`foldcase mcp` catalog server (Phase 1.2)** — a real MCP server (replaces the `MCP_PLACEHOLDER`
  stub) as an **Effect service** exposing the story catalog (list Showcases, get argTypes/**Effect
  Schema**, run a Showcase's play → typed pass/fail). Composes with the existing `@foldkit/devtools-mcp`
  (already a dep of `src/pwa/`): catalog = *which* Showcases exist; devtools-mcp = *drive* the live
  runtime (`dispatch_message`/`get_model`/`replay`). Requests/responses are `Schema`, config via
  `Config`. `bun test`.
- **Schema-driven Controls (Phase 1.3)** — leans on the fact that **Foldkit already uses Effect
  Schema** for the Message union (`foldkit_get_message_schema` exists). Derive controls from Schema,
  dispatch setter Msgs into the live runtime (fix the remount-discards-Model bug at
  `foldkit/renderer.ts:215`). The panel itself is a Foldkit view → vitest + `@cosmos/oxlint-plugin-foldkit`.
- **a11y / actions / visual (Phase 2)** — a11y = `axe-core` at the renderer `mount()` boundary; actions
  = surface the Foldkit message stream (`foldkit_list_messages`); visual = Playwright screenshot per
  Showcase with an "unresolved" state. All headless pieces are Effect programs under `bun test`.

**Net:** the openstory fork stays upstream-friendly; everything *new and Foldkit-specific* is a
CosmOS tool on Bun + Effect 4, gated by the CosmOS oxlint plugins + patched tsc, TDD'd with `bun
test`, and dogfooded on the Todoer PWA. That is what makes Foldcase "our own Effect-4 Foldkit tool"
rather than just a fork.

### Sources
Storybook MCP/Vitest: storybook.js.org/docs/ai/mcp/overview, /docs/writing-tests/integrations/vitest-addon,
/docs/writing-tests/interaction-testing, /docs/api/portable-stories/portable-stories-vitest,
/docs/api/arg-types, /docs/essentials/controls, /docs/essentials/actions,
/docs/writing-tests/accessibility-testing · MCP Apps: blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps,
mcpui.dev · Chromatic: chromatic.com/frontend-workflow-for-ai · Applitools: applitools.com ·
Ladle: ladle.dev · Openstory: github.com/millionco/openstory.
Foldkit APIs (Story/Scene/DevTools) and Foldcase seams: file:line anchors throughout this repo's
`packages/openstory/src`, the Foldkit checkout `packages/foldkit/src/{test,devTools,runtime}`, and
`packages/devtools-mcp/src/tools.ts`.
