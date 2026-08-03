# Foldcase

**The typed test loop for [Foldkit](https://github.com/binarytide/foldkit) components.**

A **Showcase** is one component in one state, with a `play` that drives it and asserts on
the result. Foldcase runs Showcases headlessly in CI, serves them to a coding agent over
MCP, and turns their schemas into Markdown tables.

> The name: **fold** (Foldkit) + (show)**case**. Foldkit's testing family is Story and
> Scene; a Showcase is the isolation layer between them — the component performing outside
> the app.

## Why it exists

Most component-test loops mount a browser, poke the DOM and read untyped callbacks. They
test a rendering rather than a state machine, so they guess at what happened and they
flake. Foldkit hands over three facts that remove the guessing:

- the **Model** is one serializable value, so a test reads the whole state instead of
  scraping rendered text;
- the **Message** union is an Effect `Schema`, so it can be introspected into JSON Schema
  and a valid payload can be built by construction;
- **`update` is pure**, so the same Messages always give the same Model.

Nothing was reading those facts. You can already assert on `update` in a plain `bun test`
file — but a test is a function that runs, not a description of anything. It cannot say
which components exist, which states they are shown in, or what Messages they take. So the
same knowledge gets written down again for the docs, and again for whatever a coding agent
is told, and the three copies drift.

Foldcase removes the copies. A **Showcase** declares the component, the state and the play
**once**; the CI run, the Markdown docs, the coverage report and the agent's catalog are
all read off that single record — never parsed back out of your source
([ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md)).

### What it adds over a plain test file

| | `bun test` alone | with Foldcase |
|---|---|---|
| Assert a Model after typed Messages | yes | yes — `foldcase test`, one exit code for CI |
| Enumerate the components and their states | no | `foldcase mcp` serves the whole catalog |
| Answer what a Message payload looks like | no | the Message `Schema` as a JSON Schema document |
| Document the Model | no | `foldcase docs` — one Markdown table per component |
| Attribute coverage to a component state | no | `--coverage` — per Showcase and in aggregate |
| Hand any of it to a coding agent | no | three read-only MCP tools over stdio |

A Showcase dispatches a typed Message and asserts on a deterministic Model — no DOM, no
selectors, no waiting.

## Install

```bash
npm  install -D foldcase       # or pnpm add -D / yarn add -D
bun  add     -d foldcase
```

Foldcase ships as a compiled `dist/` — one `.js` and one `.d.ts` per source file, built by
plain `tsc`, no bundler — so npm, pnpm, Vite and Bun all consume it as ordinary ESM.

**Two bins, one per runtime:**

| Bin | Runtime | Needs |
|---|---|---|
| `foldcase` | Node | Node **22.18** or newer, because it loads your `*.showcase.ts` through Node's own type stripping |
| `foldcase-bun` | Bun | Bun **1.3.14** or newer |

Both run the same program; only the shell around it differs. `engines` states both, and
`@effect/platform-node` / `@effect/platform-bun` are **optional** peer dependencies — you
need only the one your bin uses.

There is **no single-file binary.** `bun build --compile` was dropped as a release
artifact: a compiled binary resolves `import(path)` inside its own embedded filesystem, so
it could never load a `*.showcase.ts` from your project — which is the tool's whole job.

### Peer dependencies

- **`effect` v4** — a peer dependency, so your app and Foldcase share one Effect instance.
  The range is `>=4.0.0-beta.90`, and both ends of it are run: the suite passes on the
  floor and on `4.0.0-beta.102`, the version Foldkit pins. Effect is in beta, and its JSON
  Schema output moves between betas, so the docs generator reads a Model's types from the
  shape of the encoding rather than from names that come and go.
- **Node on `PATH`** — only for `foldcase test --coverage`, explained below. Under the Node
  bin you already have it.

Foldcase does *not* depend on Foldkit. The `play` thunk is opaque to the runner, so
Foldkit Showcases run in your app's own closure while Foldcase stays framework-blind.

> Foldcase is alpha. Any patch may break the public API. The package name and import path
> stay lowercase (`foldcase`) because npm forbids capitals; the tool is **Foldcase**.

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
  },
]
```

Assertions come from `node:assert` rather than `bun:test`, because a catalog is loaded by
whichever bin you run — `foldcase` under Node, `foldcase-bun` under Bun — and an import
only one runtime has would tie the catalog to that runtime.

The seam is deliberately small:

```ts
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void> // throws on assertion failure
  readonly message?: Schema.Top // Message-union Schema — read by `mcp` and `docs`
  readonly model?: Schema.Top // Model Schema — read by `docs`
}
```

`play` is any thunk that throws when an assertion fails, so a Showcase is not tied to one
assertion library or one framework. `message` and `model` are optional; a Showcase that
declares neither still runs, and `foldcase docs` documents it with a note instead of
failing.

Everything Foldcase does is derived from this one record. See
[ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md).

A working app is in [`examples/counter`](examples/counter) — two Foldkit components, eight
Showcases, and the [Markdown](examples/counter/docs/tasks.md) `foldcase docs` writes from
them. `mise run dogfood` runs it under both bins on every change, so the example is a check
as well as a demo.

## The three commands

### `foldcase test` — Showcases as CI

Finds every `*.showcase.ts` under a path, runs each `play`, and prints a pass/fail line
per Showcase plus a rolled-up count. The exit code is 1 if anything failed, and also 1 if
nothing was found — an empty run must never read as "everything passed".

```bash
foldcase test              # the current directory
foldcase test src/ui       # a directory
foldcase test button.showcase.ts   # a single file
```

```
  ✓ counter/click-twice
  ✗ button/disabled — expected true, got false

2 total · 1 passed · 1 failed
```

A `*.showcase.ts` that will not import — a bad path, a missing dependency — is reported as
a failed entry for that **file**, and the rest of the run continues:

```
  ✗ src/ui/picker.showcase.ts — Error [ERR_MODULE_NOT_FOUND]: Cannot find module './picker'
  ✓ counter/click-twice

2 total · 1 passed · 1 failed
```

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
- That subprocess resolves modules the way **Node** does, which is stricter than Bun. A
  file Bun imports happily can fail there — a directory import is the common one. Such a
  file is listed under **`not measured:`** with the reason, and counted on the summary
  line, so a truncated measurement never reads as a whole one.
- It is **additive**: it never changes the run's pass/fail exit code, and a collection
  failure is a warning rather than an error.

### `foldcase docs` — Model and Message tables

Introspects each component's `message` and `model` Schemas and writes **one Markdown file
per component**.

```bash
foldcase docs src/ui docs/schemas
foldcase docs                 # output goes to FOLDCASE_DOCS_DIR, default ./foldcase-docs
```

A **component** is the set of Showcases that declare the same `message` and `model` — in a
real showcase file, every Showcase of one component, because they share the declared
schema objects. The file is named after the id namespace they share, so five Showcases
under `ui/picker/*` produce one `ui-picker.md` listing the ids behind it — rather than five
files that differ only in their title.

The Message table is `Message | Field | Type | Optional`, one row per tag and payload
field. The Model table is `Field | Type | Optional`. Types describe the value your Model
**holds**, not the JSON it serializes to: a `Schema.DurationFromMillis` field reads
`Duration`, not `number`, and a `Schema.Option(T)` field reads `Option<T>` with Optional
`yes`. Beyond that the `number | "NaN" | "Infinity"` encoding collapses to `number`,
`Array<T>` reads `T[]`, a named class field resolves to its definition name, and a `|`
inside a type is escaped so the table survives it. Output is sorted, so regenerating gives
a clean diff.

A file that will not load is named on stderr and the command exits non-zero; the documents
it could write are still written.

### `foldcase mcp` — the catalog for an agent

Serves the catalog to a coding agent over stdio MCP. Three tools:

| Tool | What it does |
|---|---|
| `foldcase_list_showcases` | Enumerate every Showcase, flagged with whether it carries a Message schema. |
| `foldcase_get_showcase_schema` | Introspect a Showcase's Message union into a JSON Schema document, so the agent builds a valid payload by construction. |
| `foldcase_run_showcase` | Run a Showcase's `play` and return the typed pass/fail report. |

All three are annotated `readOnlyHint: true`, `destructiveHint: false` and
`openWorldHint: false`, because all three only read the declared catalog and run a pure
`play` in this process — so a host does not prompt for confirmation to list a catalog.

The whole toolkit is registered before the server reads a byte of stdin, so a host that
discovers its tools once at startup gets all three from its **first** `tools/list`.

```bash
foldcase mcp                                    # point your MCP host's stdio command here
FOLDCASE_SHOWCASE_DIR=src/ui foldcase mcp       # scan a specific directory
```

A showcase file that will not load is logged to stderr and the rest of the catalog is
served anyway.

This is the **static** half of the loop: which Showcases exist, what their Messages look
like, and what happens when one runs. It composes with Foldkit's own devtools MCP, which
drives the **live** runtime. Together an agent can enumerate, read the schema, dispatch a
valid typed Message, assert the resulting Model, re-run the Showcase, and read a structured
result — with no DOM in the path.

## Programmatic use

| Import | What you get |
|---|---|
| `foldcase` | `Showcase`, `runShowcase`, `runShowcases`, `suiteOf`, the `ShowcaseReport` / `SuiteReport` Schemas, `formatSuite`, `suiteExitCode` |
| `foldcase/cli` | `discoverShowcaseFiles`, `loadShowcasesFromFiles`, `runCatalog`, `runSuiteFromFiles`, `docsFromFiles` |
| `foldcase/mcp` | the launchable stdio server Layer, and `makeFoldcaseMcpServer` over your own catalog Layer |

Every report is a decoded `Schema` value, not a loose object, so a failure is structured
data you can act on rather than a string you have to parse. `loadShowcasesFromFiles`
returns `{ showcases, failures }` and never fails, so you decide what an unloadable file
means for your surface.

## Where it came from, and what changed

Foldcase grew out of a fork of [Openstory](https://github.com/millionco/openstory), a
framework-agnostic component explorer: CSF-3 story files, a prebuilt React shell, a Vite
dev server, adapters for React, Solid, Vue and Svelte, all on pnpm and turbo. The part that
carried the value was the headless runner — so that part became the whole tool, and the
shell stayed behind.

What this line adds:

- **one definition of a component**, not two — the `Showcase` record replaces CSF-3's
  `Meta` plus `StoryObj`, and there is no story-file parser to keep in step with it;
- **typed contracts end to end** — Effect `Schema` for every report, tagged errors with
  real payloads, so a failure is data you can act on rather than a string to parse;
- **an MCP catalog**, which is what makes the loop usable by a coding agent;
- **coverage attributed to a component state**, per Showcase, not per file;
- **headless everywhere** — no browser, no bundler, no dev server, and one bin each for
  Node and Bun.

What it drops: the React shell, CSF-3, the four framework adapters, pnpm/turbo/Vite, and
the Vitest/Playwright visual gate. Two things are kept and credited — the `play` contract
and the `SerializedError` shape; [`NOTICE`](NOTICE) records exactly what. The old line
still lives on the `foldkit` branch as history, not as a dependency. The reasoning is
[ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md).

## Status

The `core` branch is the live line. The runner, the MCP server, the docs generator, and the
coverage collector are here with their history, and the two gates the decisions promised —
the toolchain fence and the derivation spine — run with the rest of the suite.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first; it is short and it is binding for humans and agents
alike. Then:

```bash
mise run setup      # once, after installing
mise run test
mise run lint
mise run typecheck
mise run build      # tsc -b → dist/; the published shape
mise run smoke      # drive the built dist/ under Node and Bun (after build)
```

CI runs exactly these on every push. `mise` pins Bun, oxlint **and Node 22.18.0** — the
floor `engines` claims — so nothing is tested against whatever Node a machine happened to
have.

## License

MIT. Foldcase began as a fork of [Openstory](https://github.com/millionco/openstory) and
keeps its copyright notice; [`NOTICE`](NOTICE) records exactly what is still derived from
it.
