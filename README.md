<p align="center">
  <img src="docs/brand/mark.svg#gh-light-mode-only" alt="Foldcase" width="88" height="88">
  <img src="docs/brand/mark-inverse.svg#gh-dark-mode-only" alt="Foldcase" width="88" height="88">
</p>

# Foldcase

**One typed record per component state — read by your coding agent, your CI, your docs,
and your coverage.**

<!-- site:skip -->

📖 **[Read the documentation](https://foldcase-docs.1st-account.workers.dev)** — this
README, the changelog and every ADR, with search, per-page Markdown and an `llms.txt` for
agents. It is generated from the files in this repository, so it cannot say anything they
do not (see [ADR-0003](docs/adr/0003-the-documentation-site-lives-here.md)).

<!-- /site:skip -->

Foldcase exists so a coding agent can work on a [Foldkit](https://github.com/foldkit/foldkit)
codebase without guessing. Foldkit ships two ways to test a component — a Story over
`update`, a Scene over the rendered markup — but both are functions: they run, they pass,
and afterwards nothing can ask them which components exist, which states are covered, or
what a Message payload must contain. A **Showcase** writes those facts down. It is a
record, not a function, so one declaration can be enumerated, introspected into JSON
Schema, run by id, and reported as typed data.

Point an agent at `foldcase mcp` and it stops reading your source to learn what a
component does: it lists the catalog, reads the Message Schema, builds a valid payload by
construction, runs the Showcase, and gets back a structured pass/fail that names the file
to open. The same loop runs from the shell as `foldcase test --json`. And the same
declaration produces your CI exit code, your Markdown schema tables, and your per-state
coverage — so what the agent reads and what CI enforces cannot drift apart.

- **`foldcase test`** — every Showcase headless, one exit code for CI, `--json` for
  machines, `--coverage` attributed per component state.
- **`foldcase mcp`** — six read-only tools that serve the catalog to an agent over stdio.
- **`foldcase docs`** — one Markdown file per component, tabling its Model and Message
  Schemas.
- **`foldcase lab`** — the entry module for a browser gallery, built and served by the dev
  server your Foldkit app already runs.

```
  ✓ counter/starts-at-zero
  ✓ counter/step-of-ten
  ✗ tasks/adds-in-order — expected 2, got 1

3 total · 2 passed · 1 failed
```

## Quickstart

From nothing to a green run:

```bash
mkdir hello && cd hello && bun init -y
bun add -d foldcase@alpha effect@4.0.0-beta.102 @effect/platform-bun@4.0.0-beta.102
```

Under Node 22.18+ swap the tooling:
`npm install -D foldcase@alpha effect@4.0.0-beta.102 @effect/platform-node@4.0.0-beta.102`,
then `npx foldcase` wherever this page says `bunx foldcase-bun`. Pin the platform package
to the same Effect beta your app pins — `latest` is still the v3 major and will not load;
see [Peer dependencies](#peer-dependencies).

`hello.showcase.ts` — self-contained, so the pipeline shows without Foldkit:

```ts
import assert from "node:assert/strict"

import type { Showcase } from "foldcase"

type Model = { count: number }
const update = (model: Model, step: number): Model => ({ count: model.count + step })

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/counts-two-clicks",
    play: () => {
      const model = update(update({ count: 0 }, 1), 1)
      assert.equal(model.count, 2)
    },
  },
]
```

```bash
bunx foldcase-bun test
```

```
  ✓ counter/counts-two-clicks

1 total · 1 passed · 0 failed
```

Exit code 0. In a Foldkit app, `play` holds a Story and the record carries the real
Message and Model Schemas — see [Writing a Showcase](#writing-a-showcase).

## Wire it into your agent

One command does the wiring:

```bash
npx foldcase init        # or: bunx foldcase-bun init
```

It adds the server entry below to `.mcp.json` — choosing `bunx` or `npx` by your
lockfile, and setting `FOLDCASE_SHOWCASE_DIR=src` when `src/` exists — and appends the
[`AGENTS.md` block](#paste-into-your-agentsmd). Both edits are idempotent and merge-safe:
an existing `.mcp.json` keeps its other servers, a `foldcase` entry already there is left
alone, and a second run reports `kept` and changes nothing. By hand, the same entry
(Claude Code and most MCP hosts) is:

```json
{
  "mcpServers": {
    "foldcase": {
      "command": "npx",
      "args": ["foldcase", "mcp"],
      "env": { "FOLDCASE_SHOWCASE_DIR": "src" }
    }
  }
}
```

Or in one line: `claude mcp add foldcase -e FOLDCASE_SHOWCASE_DIR=src -- npx foldcase mcp`.
Under Bun the command is `bunx` with args `["foldcase-bun", "mcp"]`.

`FOLDCASE_SHOWCASE_DIR` (default `.`) is read by `mcp` only. A relative value resolves
against the directory the host launches the server in — for Claude Code, the project
root — and becomes the server's root: `foldcase_load_catalog` resolves relative
directories against that root, never against the currently served one, so no sequence of
loads can walk away from it.

The six tools, all annotated `readOnlyHint: true`, `destructiveHint: false`,
`openWorldHint: false` — a host does not prompt for confirmation to list a catalog:

| Tool | What it does |
|---|---|
| `foldcase_list_showcases` | Enumerate every Showcase — which Schemas it carries, which Messages it dispatches, the directory served — and per-component `gaps`: the Messages no play dispatches. |
| `foldcase_get_showcase_schema` | Introspect a Showcase's Message union into a JSON Schema document, so the agent builds a valid payload by construction. |
| `foldcase_get_showcase_model_schema` | The same for the Model — the shape a `play` asserts on, which an agent has to know before it writes one. |
| `foldcase_run_showcase` | Run one Showcase's `play` — in a fresh subprocess, from the code on disk — and return the typed pass/fail report, naming the file it came from. |
| `foldcase_run_catalog` | Run the whole catalog into one suite report, or the part of it under an id prefix: `counter/` runs one component. Fresh from disk, like `foldcase_run_showcase`. |
| `foldcase_load_catalog` | Refresh the listing after files appear or vanish, or point the server at another directory under the root. Reports how many Showcases came back and which files would not load. A run never needs it. |

The loop an agent runs:

1. `foldcase_list_showcases` — which components exist, in which states; the
   `hasMessageSchema` / `hasModelSchema` flags say which introspection call is worth
   making, and `gaps` names, per component, the Messages no play dispatches — the next
   Showcase to write.
2. `foldcase_get_showcase_schema` — the Message union as a draft-2020-12 JSON Schema
   document: a valid payload by construction, not by reading the source.
3. `foldcase_get_showcase_model_schema` — the shape a `play` asserts on; read it before
   writing one.
4. Edit the code, or add a Showcase.
5. `foldcase_run_showcase` for one state, or `foldcase_run_catalog` with
   `id_prefix: "counter/"` for one component. A run executes in a fresh subprocess and
   reads the disk, so the edit it is verifying — even a brand-new file — is already in
   it, no reload needed. A failing `play` is `status: "failed"` with a full
   `SerializedError` — data, never a tool error — and a mistyped id returns every
   available id, so it corrects itself in one round trip.
6. `foldcase_load_catalog` to refresh the *listing* after files appear or vanish. The
   listing and the two schema tools read modules the server already imported, so after an
   edit inside a loaded file their metadata can lag until the server restarts; the run
   tools never lag.

No MCP host? The same loop is the CLI: `foldcase test --json` prints one typed JSON
document on stdout, diagnostics on stderr, and every report names its file.

Foldcase is the static half of a two-server loop.
[`@foldkit/devtools-mcp`](https://github.com/foldkit/foldkit/tree/main/packages/devtools-mcp)
drives the live runtime — it needs a Vite dev server and an open browser tab; Foldcase
needs only a directory of files, so it also runs in CI. The verbs pair up:

| question | live — `@foldkit/devtools-mcp` | declared — `foldcase mcp` |
|---|---|---|
| what exists | `foldkit_list_runtimes` (open tabs) | `foldcase_list_showcases` |
| Message shape | `foldkit_get_message_schema` | `foldcase_get_showcase_schema` |
| the Model | `foldkit_get_model` (the value now) | `foldcase_get_showcase_model_schema` (the type) |
| act | `foldkit_dispatch_message` | `foldcase_run_showcase` |

devtools-mcp answers *what the app is doing right now*; Foldcase answers *what the app is
supposed to do*.

### Paste into your `AGENTS.md`

```markdown
## Showcases (Foldcase)

- Components are described by Showcases: `export const showcases: ReadonlyArray<Showcase>`
  in `*.showcase.ts` files. The record is `{ id, play, message?, model?, dispatches? }`;
  an id is `component/state`.
- To learn a component, use the `foldcase_*` MCP tools or `npx foldcase test --json` —
  do not parse `*.showcase.ts` files or crawl the source for the same facts.
- When you add a component state, add a Showcase for it, and name the Message tags its
  play sends in `dispatches` — the listing's `gaps` then says which Messages still have
  no Showcase.
- When you change a Message or Model Schema, regenerate the tables: `npx foldcase docs
  src docs/schemas`. In CI, `--check` fails on drift instead of writing.
- The run tools execute what is on disk, edits included. Only the listing and schema
  tools can lag behind an edit inside a loaded file; restart the server to refresh them.
- Exit 1 means a failed Showcase, an unloadable file, or an empty catalog. All three are
  reported as data; one bad file never hides the rest.
```

## Why a Showcase

Most component-test loops mount a browser, poke the DOM and read untyped callbacks.
Foldkit removes the need: the **Model** is one serializable value, the **Message** union
is an Effect `Schema`, and **`update` is pure** — the same Messages always give the same
Model. A test over those facts asserts on the whole state instead of scraped text, and it
cannot flake.

But a test is a function that runs, not a description of anything. It cannot say which
components exist, which states they are shown in, or what Messages they take — so the same
knowledge gets written down again for the docs, and again for whatever a coding agent is
told, and the copies drift. A Showcase declares the component, the state and the play
**once**; the CI run, the Markdown docs, the coverage report and the agent's catalog are
all read off that single record — never parsed back out of your source
([ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md)).

| | `bun test` alone | with Foldcase |
|---|---|---|
| Assert a Model after typed Messages | yes | yes — `foldcase test`, one exit code for CI |
| Enumerate the components and their states | no | `foldcase mcp` serves the whole catalog |
| Answer what a Message payload looks like | no | the Message `Schema` as a JSON Schema document |
| Document the Model | no | `foldcase docs` — one Markdown table per component |
| Attribute coverage to a component state | no | `--coverage` — per Showcase and in aggregate |
| Hand any of it to a coding agent | no | six read-only MCP tools over stdio |

## Story, Scene, Showcase

Foldkit already ships two ways to test a component. Foldcase adds a third that is not a
way of testing at all.

**Story** — `foldkit/story` — drives `update` and everything it returns: send Messages,
resolve the Commands they produce (`Command.resolveAll` cascades through a whole async
flow), assert on the Model and on OutMessages. It accounts for every Command the reducer
returned, so a story cannot pass on one you forgot to think about.

```ts
story(
  update,
  given(initialModel),
  message(ClickedIncrement()),
  Command.expectNone(),
  model((m) => assert.equal(m.count, 1)),
)
```

**Scene** — `foldkit/scene` — mounts `{ update, view }` and reads the rendered markup
the way a user does: `getByRole`, `getByLabel`, `click`, `type`, `dropFiles`. It renders
to Foldkit's virtual tree and queries that, so it needs no browser and no DOM — the
vitest-plus-happy-dom setup in Foldkit's examples is convention, not a requirement;
[`examples/counter`](examples/counter) runs two Scene Showcases under both bins with no
DOM package installed. A failed assertion names the locator — `Expected element matching
button "Restart" to exist` — so a miss reads as "the control you asked for is not in the
markup". What a Scene deliberately cannot see is the Model: it asserts through the view.

```ts
scene(
  { update, view },
  given(homeModel),
  expect(role("link", { name: "Calendar" })).toExist(),
)
```

The two answer different questions, and neither catches the other's bugs — and some bugs
escape both. Building the Foldkit component gallery showed the ceiling: a Story proved
`DragAndDrop` moves a card between columns and lands it in the right place, and it was
right — but a real browser showed that the card's element is rebuilt when it changes
column, so focus drops to `<body>` halfway through a keyboard drag. Element identity
across a re-render is invisible to a Model assertion and to a virtual render alike; only a
browser sees it. Test the machine with a Story, the markup with a Scene, and keep a
browser in the loop for what only it can show.

**A Showcase is neither.** It is a record, not a function:

```ts
{ id, play, message?, model?, dispatches? }
```

`play` usually holds a Story — the cheap, deterministic half — but the runner never looks
inside it. What Foldcase reads is everything around it: the `id` names one component in
one state, and `message`/`model` are the Schemas that state is built from. A Story and a
Scene are functions a runner calls; they run, they pass, and they are gone. A Showcase is
a **description that stays readable**, so one declaration feeds the CI run, the Markdown
tables, the coverage attribution and the agent's catalog at once.

| | drives | answers | cannot see |
|---|---|---|---|
| **Story** | `update` + Commands + OutMessages | is the state machine right | the markup |
| **Scene** | `update` + `view`, virtually rendered | does the markup reach the machine | the Model — opaque by design |
| **Showcase** | whatever `play` holds — usually a Story | which components exist, in which states, built from which Schemas | — |

Foldcase does not depend on Foldkit, and `play` is an opaque thunk: it can hold a Story, a
Scene, another assertion library, or plain code, and stays headless either way.

## Writing a Showcase

A Showcase file is named `*.showcase.ts` and exports one array. There is no metadata
format to learn and no parse step — the array *is* the catalog.

```ts
import assert from "node:assert/strict"

import type { Showcase } from "foldcase"
import { Story } from "foldkit/test"

import { ClickedIncrement, initialModel, Message, Model, update } from "./counter"

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/click-twice",
    play: () =>
      Story.story(
        update,
        Story.given(initialModel),
        Story.message(ClickedIncrement()),
        Story.message(ClickedIncrement()),
        Story.model((model) => assert.equal(model.count, 2)),
      ),
    message: Message, // optional — the Message-union Schema
    model: Model, // optional — the Model Schema
    dispatches: ["ClickedIncrement"], // optional — the tags this play sends
  },
]
```

Assertions come from `node:assert` rather than `bun:test`, because a catalog is loaded by
whichever bin you run — `foldcase` under Node, `foldcase-bun` under Bun — and an import
only one runtime has would tie the catalog to that runtime.

The seam is small on purpose:

```ts
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void> // throws on assertion failure
  readonly message?: Schema.Top // Message-union Schema — read by `mcp` and `docs`
  readonly model?: Schema.Top // Model Schema — read by `docs` and `mcp`
  readonly dispatches?: ReadonlyArray<string> // Message tags the play sends — validated against `message`
}
```

`play` is any thunk that throws when an assertion fails, so a Showcase is not tied to one
assertion library or one framework. `message` and `model` are optional; a Showcase that
declares neither still runs, and `foldcase docs` simply writes no page for it — there is
nothing to table. `dispatches` is optional too, and declared rather than observed — a
closure cannot be watched — so it is validated against the Message union: a tag the union
does not carry fails `foldcase docs`, and an absent declaration means *unknown*, never
"sends nothing" (an empty array says that).

Everything Foldcase does is derived from this one record. See
[ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md).

A working app is in [`examples/counter`](examples/counter) — two Foldkit components, ten
Showcases (two of them holding a Scene), every `dispatches` declared, and the
[Markdown](examples/counter/docs/tasks.md) `foldcase docs` writes from them. `mise run
dogfood` drives it under both bins in CI, so the example is a check as well as a demo.

### A type-only import must say `import type`

The `foldcase` bin loads your catalog through Node's type stripping, and Node cannot tell
a type-only import from a value import — it emits a real ESM import for both. So a
showcase, or **any module it reaches**, that writes

```ts
import { Document, Html } from "foldkit/html" // these are types
```

will not load: `SyntaxError: The requested module 'foldkit/html' does not provide an export
named 'Document'`. Write `import type { Document, Html } from "foldkit/html"` instead.
Foldcase names the cause and the fix in the failed-file line, so you need not recognise the
error yourself.

`foldcase-bun` erases the import itself and has no such rule.

## The four commands

### `foldcase test` — Showcases as CI

Finds every `*.showcase.ts` under a path, runs each `play`, and prints a pass/fail line
per Showcase plus a rolled-up count. The exit code is 1 if anything failed, and also 1 if
nothing was found — an empty run must never read as "everything passed".

```bash
foldcase test              # the current directory
foldcase test src/ui       # a directory
foldcase test button.showcase.ts   # a single file
```

A `*.showcase.ts` that will not import — a bad path, a missing dependency, a
[type imported as a value](#a-type-only-import-must-say-import-type) — is reported as a
failed entry for that **file**, and the rest of the run continues:

```
  ✗ src/ui/picker.showcase.ts — Error [ERR_MODULE_NOT_FOUND]: Cannot find module './picker'
  ✓ counter/click-twice

2 total · 1 passed · 1 failed
```

Extra positionals and unknown flags are refused, not ignored: `foldcase test a.ts b.ts`
and `foldcase test src --covrage` both name what was not understood and exit 1, because
running half of what you asked for behind a green exit would be a lie — and for an agent,
a typo that silently no-ops is the worst failure mode.

#### `--coverage`

Adds a V8 line and function coverage summary of the code each `play` actually executed —
per Showcase and in aggregate.

```bash
foldcase test src/ui --coverage
```

```
coverage:
  src/ui/Button.showcase.ts  lines 42/48 (88%)  fns 6/7 (86%)

not measured:
  src/ui/Picker.showcase.ts — Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import …

1 file(s) · lines 42/48 (88%) · fns 6/7 (86%) · 1 not measured

by showcase:
  ✓ button/default   lines 30/48 (63%)
  ✓ button/disabled  lines 24/48 (50%)
  ? picker/open      no coverage collected
```

Read the limitations before you rely on it:

- It needs **Node on `PATH`** and runs the measurement in a **spawned Node subprocess**,
  because Bun exposes no programmatic V8 precise coverage.
- The collector runs every `play` twice more — an aggregate pass and a per-Showcase
  pass — on top of the suite run. Keep plays pure and fast.
- The subprocess resolves modules the way **Node** does, which is stricter than Bun. A
  file Bun imports happily can fail there — a directory import is the common one. Such a
  file is listed under **`not measured:`** with the reason, and counted on the summary
  line, so a truncated measurement never reads as a whole one.
- It is **additive**: it never changes the run's pass/fail exit code, and a collection
  failure is a warning rather than an error.

#### `--json`

Prints the run as one JSON document instead of the summary, for a script or an agent that
has to act on it rather than read it.

```bash
foldcase test src/ui --json
foldcase test src/ui --json --coverage    # coverage rides in the same document
```

```json
{
  "suite": {
    "total": 2, "passed": 1, "failed": 1,
    "reports": [
      { "id": "counter/click-twice", "status": "passed",
        "file": "/abs/src/ui/counter.showcase.ts" },
      { "id": "button/disabled", "status": "failed",
        "file": "/abs/src/ui/button.showcase.ts",
        "error": { "name": "AssertionError", "message": "expected true, got false" } }
    ]
  }
}
```

- **Every report names its file.** An id alone does not say what to open, and the loader —
  not the author — holds that fact, so it is carried in the report rather than declared on
  the `Showcase`.
- **A failure is a full `SerializedError`** — `name`, `message`, the `stack`, and `code`
  when the runtime set one — not the two-field sketch above.
- **stdout is the document and nothing else.** Logs and warnings go to stderr.
- **The exit codes do not move**: 1 on any failure, 1 when nothing was discovered — and a
  run that discovered nothing prints no document at all, because `"failed": 0` would read
  as a clean run.

### `foldcase docs` — Model and Message tables

Introspects each component's `message` and `model` Schemas and writes **one Markdown file
per component**.

```bash
foldcase docs src/ui docs/schemas
foldcase docs                 # output goes to FOLDCASE_DOCS_DIR, default ./foldcase-docs
```

A **component** is the set of Showcases sharing an id namespace — everything before the
last `/`. Five Showcases under `ui/picker/*` produce one `ui-picker.md`,
`button/starts-unclicked` and `button/counts-one-click` are the `button` component, and an
id with no `/` is its own. This is the same notion of a component `foldcase_run_catalog`
filters on with an `id_prefix`.

Each table is read from the first Showcase, in id order, that declares that Schema, so a
namespace holding both plain logic Showcases and schema-carrying ones still documents. A
component whose Showcases declare neither Schema has nothing to table and gets no file.

The Message table is `Message | Field | Type | Optional`, one row per tag and payload
field; the Model table is `Field | Type | Optional`. Types describe the value your Model
**holds**, not the JSON it serializes to — from
[`examples/counter`](examples/counter/docs/tasks.md):

| Field | Type | Optional |
| --- | --- | --- |
| `autosaveAfter` | Duration | no |
| `filter` | "all" \| "open" \| "done" | no |
| `selected` | Option&lt;string&gt; | yes |
| `tasks` | Task[] | no |

A `Schema.DurationFromMillis` field reads `Duration`, not `number`; `Schema.Option(T)`
reads `Option<T>` with Optional `yes`; a named class resolves to its definition name; a
`|` inside a type is escaped so the table survives it. Output is sorted, so regenerating
gives a clean diff.

A Showcase may declare `dispatches` — the Message tags its play sends. Once any Showcase
of a component declares them, the page adds a `Not showcased:` line naming the union tags
no play dispatches: the next Showcase to write. A declared tag the union does not carry
is a lie in the catalog — it is named on stderr and the command exits 1. A component
where no Showcase declares stays silent, because unknown must never read as covered.

A file that will not load is named on stderr and the command exits non-zero; the documents
it could write are still written. With every file loaded, the exit is 0 — including when
nothing was written because no Showcase declares a Schema.

`--json` works here too, and says what was written and what would not load:

```json
{
  "docs": [{ "component": "counter", "path": "/abs/docs/schemas/counter.md" }],
  "failures": [{ "_tag": "foldcase/ShowcaseModuleError",
                 "path": "/abs/src/ui/picker.showcase.ts",
                 "reason": "Cannot find module './picker'" }],
  "gaps": [{ "component": "counter",
             "undispatched": ["ClickedReset"], "unknown": [] }]
}
```

### `foldcase lab` — the browser gallery

Writes the entry module for the browser lab, and stops. It bundles nothing, serves
nothing and starts no watcher: a Foldkit app already runs Vite with
`@foldkit/vite-plugin`, and that dev server is the one that builds the lab
([ADR-0004](docs/adr/0004-the-lab-is-a-foldkit-app-the-consumer-builds.md)).

```bash
foldcase lab src/ui src/lab.entry.ts
foldcase lab                # the entry goes to FOLDCASE_LAB_ENTRY, default ./foldcase-lab.entry.ts
```

The module it writes imports `foldcase/lab`, imports the `showcases` of every catalog it
discovered, and starts the runtime on them. Point a page at it — `<script type="module"
src="/src/lab.entry.ts"></script>` — and open the dev server you already run.

The sidebar is the catalog by component, then by state, with a row for any file the loader
could not read. Four tabs read whatever is selected four ways: **Canvas** mounts it in a
shadow root of its own, so its stylesheet cannot reach the shell and the palette still
cascades in; **Entry** prints the six fields the listing carries; **Timeline** records what
a mount relays; **Schema** says what the Message and Model documents actually are. A drawer
under them carries the browser-runtime facts, the six MCP tools, the entry as JSON, and the
fields a catalog browser usually shows that a Foldcase listing does not.

The trail beside the canvas is the mount's to fill. Foldkit gives a host no read on a
runtime it did not build — the store that records Messages is private to that runtime, and
ports are declared by the application itself — so a mount that wants its dispatches on the
trail posts them:

```ts
window.postMessage({ foldcase: 'dispatch', tag: `Clicked({ clicks: ${clicks} })` }, '*')
```

The lab decodes that envelope with `Schema`, ignores everything else on the channel, and
measures the gap between arrivals itself. A mount that posts nothing leaves the trail
empty, which is the honest reading rather than a guess.

Nothing in it claims a status, a duration or a coverage number, because a listing carries
none — those belong to a run. A row's mark says whether the canvas can mount that entry and
says nothing else, and "Live" appears only once the lab has watched the mount paint:
`Runtime.run` returns `undefined` and throws nothing when an application draws an empty
container, so an assumed mount is exactly the failure that would otherwise be labelled Live.

Regenerate it whenever a catalog file appears or vanishes, the way you regenerate docs.
`--json` prints the catalog the lab renders from beside the path it wrote, so an agent
reads the gallery without opening it. `--check` writes nothing and exits non-zero when the
entry on disk is missing or would change — the same drift gate as `docs --check`.

#### How an agent drives the lab

Every affordance in the lab is addressed by the ids `foldcase_list_showcases` already
serves, so an agent needs nothing the catalog did not already tell it. A reader selects a
Showcase by clicking; an agent opens `?showcase=<id>` or dispatches
`SelectedShowcase({ id })` through `foldkit_dispatch_message` — the lab hands devtools its
own Message union, which is what makes the second route work. Each mounted Showcase is its
own Foldkit runtime, so the live verbs reach it unchanged and the lab adds no tool of its
own.

| what you want | how you get it |
|---|---|
| open a state | `?showcase=<id>`, or `foldkit_dispatch_message` with `SelectedShowcase({ id })` |
| tell the two runtimes apart | `foldkit_list_runtimes` shows the lab and the mounted Showcase separately; one Showcase is mounted at a time, and the lab's model is the one that carries the selection |
| read or drive the component | `foldkit_get_model`, the message history and time travel, on the Showcase's own runtime |
| a screenshot of one state | nothing from Foldcase: the id is the address, so open it in the browser you already drive |

#### `--check`

Compares instead of writing — nothing is created, nothing is touched. A document that
would change or is missing is listed with its reason, and the exit is 1 on any drift, any
load failure, or any unknown dispatch; 0 when everything is current. In `--json` the same
appears as `stale: [{ component, path, reason: "missing" | "changed" }]`. Put it in CI
beside `foldcase test`, so the tables cannot drift from the catalog.

### `foldcase mcp` — the catalog server

The wiring and the six tools are [above](#wire-it-into-your-agent). Server semantics worth
knowing:

- The whole toolkit is registered before the server reads a byte of stdin, so a host that
  discovers its tools once at startup gets all six from its **first** `tools/list`.
- The server serves one catalog at a time, and `foldcase_load_catalog` is the only thing
  that moves it. A directory parameter on every verb would make an id mean nothing on its
  own, so the directory is state, and every listing and load report says which one is
  being served. A load that fails leaves the last good catalog in place.
- The run tools spawn a fresh subprocess of the server's own runtime and load from disk,
  so they always run current code. The child reuses the same single loader, and a spawn
  failure is folded into the report as a failed entry, never a silent pass.
- A showcase file that will not load is logged to stderr and the rest of the catalog is
  served anyway. Only a `FOLDCASE_SHOWCASE_DIR` that cannot be read at launch fails the
  server itself.

```bash
foldcase mcp                                    # point your MCP host's stdio command here
FOLDCASE_SHOWCASE_DIR=src/ui foldcase mcp       # serve a specific directory
```

### `foldcase init` — wire a consumer repo

Writes the `.mcp.json` server entry and the `AGENTS.md` section shown in
[Wire it into your agent](#wire-it-into-your-agent), idempotently, and reports one line
per artifact — `foldcase init: .mcp.json created|updated|kept`. `--json` prints the same
outcome as one `InitDocument`. An `.mcp.json` that will not parse is refused and left
untouched.

## Reference

Exit codes:

| Command | 0 | 1 |
|---|---|---|
| `test` | every Showcase passed | a failed Showcase, an unloadable file, or no `*.showcase.ts` found |
| `docs` | every file loaded — even if nothing was written | a load failure, a Schema that will not introspect, a dispatched tag the union does not carry, `--check` drift, or no `*.showcase.ts` found |
| `lab` | the entry was written, or `--check` found it current | a load failure, an entry that `--check` found missing or changed, or no `*.showcase.ts` found |
| `mcp` | — (serves until the host closes stdio) | the server would not launch |
| `init` | wired — created, updated, or already there | a target that does not exist, or an `.mcp.json` that will not parse |
| any | | unknown or missing verb, an unknown flag, or extra positionals — refused with the usage banner |

`--coverage` never changes an exit code.

Environment:

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `FOLDCASE_SHOWCASE_DIR` | `mcp` only | `.` | the served catalog root |
| `FOLDCASE_DOCS_DIR` | `docs` only | `foldcase-docs` | the out-dir when no second positional names one |
| `FOLDCASE_LAB_ENTRY` | `lab` only | `foldcase-lab.entry.ts` | the entry module's path when no second positional names one |

Discovery is a recursive walk for files ending in `.showcase.ts`, sorted so the report is
deterministic run to run. `node_modules` is skipped wherever it appears, so a dependency
cannot join your catalog.

CI is the exit code:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
- run: bunx foldcase-bun test src
- run: bunx foldcase-bun docs src docs/schemas --check
```

Add `--json` and redirect stdout when a later step consumes the report.

## Install, runtimes, peers

```bash
npm  install -D foldcase@alpha    # or pnpm add -D / yarn add -D
bun  add     -d foldcase@alpha
```

Releases go out under the **`alpha`** dist-tag while the API can still break, so ask for
it by name. Foldcase ships as a compiled `dist/` — one `.js` and one `.d.ts` per source
file, built by plain `tsc`, no bundler — so npm, pnpm, Vite and Bun all consume it as
ordinary ESM. There is no single-file binary, and deliberately so: a compiled binary
could never load a `*.showcase.ts` from your project, which is the tool's whole job
([ADR-0002 › Amendment 1](docs/adr/0002-bun-effect-foldkit-only.md)).

**Two bins, one per runtime:**

| Bin | Runtime | Needs |
|---|---|---|
| `foldcase` | Node | Node **22.18** or newer, because it loads your `*.showcase.ts` through Node's own type stripping |
| `foldcase-bun` | Bun | Bun **1.3.14** or newer |

Both run the same program; only the shell around it differs.

### Peer dependencies

- **`effect` v4** — a peer dependency, so your app and Foldcase share one Effect instance.
  The range is `>=4.0.0-beta.90`, and both ends of it are run: the suite passes on the
  floor and on `4.0.0-beta.102`, the version Foldkit pins today.
- **One `@effect/platform-*`, matched to the Effect beta your app pins.** Ask for the
  version by name:

  ```bash
  bun add -d @effect/platform-node@4.0.0-beta.102   # or @effect/platform-bun@…
  ```

  `latest` on both packages is still the **v3** major, and installing it pulls in a
  `@effect/cluster` built against Effect v3. The bin then dies inside a dependency you
  never asked for — `Cannot find module 'effect/dist/FiberRef.js' imported from
  @effect/cluster` — long before it reads a showcase. Both platform packages are
  **optional** peers: install only the one your bin runs. Without it, the bin names the
  package and the install command instead of printing a resolver stack trace.
- **Node on `PATH`** — only for `foldcase test --coverage`. Under the Node bin you already
  have it.

Foldcase does *not* depend on Foldkit. The `play` thunk is opaque to the runner, so
Foldkit Showcases run in your app's own closure while Foldcase stays framework-blind.

> Foldcase is alpha. Any patch may break the public API.

## Programmatic use

| Import | What you get |
|---|---|
| `foldcase` | the `Showcase` type; `runShowcase`, `runShowcases`, `suiteOf`, `suiteExitCode`, `formatSuite`; the `ShowcaseReport` / `SuiteReport` Schemas; `SerializedError` and `serializeError` |
| `foldcase/cli` | `discoverShowcaseFiles`, `loadShowcasesFromFiles`, `runCatalog`, `runSuiteFromFiles`, `docsFromFiles`; `ShowcaseModuleError` and `loadFailureReason`; the `LoadedShowcase` / `CatalogLoad` types |
| `foldcase/mcp` | `FoldcaseMcpServer`, the launchable stdio server Layer, and `makeFoldcaseMcpServer` over your own catalog Layer |
| `foldcase/mcp/catalog` | the `FoldcaseCatalog` service (`.layer`, `.layerFromShowcases`), `makeCatalog`, `loadCatalogFromDir`, and the listing / load-report / error Schemas |
| `foldcase/mcp/tools` | `FoldcaseToolkit`, `FoldcaseHandlers`, `makeHandlers` |
| `foldcase/reports` | the `--json` documents as Schemas — `TestDocument`, `DocsDocument`, `InitDocument` — plus `CoverageReport`, `StaleDoc`, `ComponentGap` and the report Schemas they carry, so a consumer decodes a document with the Schema that produced it |

Every report is a decoded `Schema` value, not a loose object, so a failure is structured
data you can act on rather than a string you have to parse. `loadShowcasesFromFiles`
returns `{ loaded, showcases, failures }` and never fails — `loaded` pairs each Showcase
with its file, `showcases` drops the file for surfaces that only run records — so you
decide what an unloadable file means for your surface.

## Provenance

Foldcase grew out of a fork of [Openstory](https://github.com/millionco/openstory) —
CSF-3 story files, a React shell, a Vite dev server. The headless runner carried the
value, so it became the whole tool: one `Showcase` record instead of `Meta` plus
`StoryObj`, Effect Schemas end to end, an MCP catalog, coverage per component state, no
browser and no bundler. The `play` contract and the `SerializedError` shape are kept and
credited — [`NOTICE`](NOTICE) records exactly what — and the old line lives on the
`foldkit` branch as history, not as a dependency. The decisions are
[ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md) (one definition, many
surfaces) and [ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md) (the Bun + Effect +
Foldkit stack).

> The name: **fold**(kit) + (show)**case** — the component performing outside the app.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first; it is short and it is binding for humans and agents
alike. Then:

```bash
mise run setup      # once, after installing
mise run lint && mise run typecheck && mise run test
mise run build && mise run smoke
```

CI runs exactly these on every push, against the same pinned Bun and Node.

## License

MIT. [`NOTICE`](NOTICE) records what is still derived from Openstory.
