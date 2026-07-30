# Foldcase

**The typed test loop for [Foldkit](https://github.com/binarytide/foldkit) components.**

A **Showcase** is one component in one state, with a `play` that drives it and asserts on
the result. Foldcase runs Showcases headlessly in CI, serves them to a coding agent over
MCP, and turns their schemas into Markdown tables.

> The name: **fold** (Foldkit) + (show)**case**. Foldkit's testing family is Story and
> Scene; a Showcase is the isolation layer between them — the component performing outside
> the app.

## Why it is different

Most component-test loops poke the DOM and read untyped callbacks, so they guess at what
happened and they flake. Foldkit hands over three things that remove the guessing:

- the **Model** is one serializable value, so a test reads the whole state instead of
  scraping rendered text;
- the **Message** union is an Effect `Schema`, so it can be introspected into JSON Schema
  and a valid payload can be built by construction;
- **`update` is pure**, so the same Messages always give the same Model.

Foldcase is built entirely on those three facts. A Showcase dispatches a typed Message and
asserts on a deterministic Model — no DOM, no selectors, no waiting.

## Requirements

- **[Bun](https://bun.sh) 1.3.14 or newer.** Foldcase is a Bun program: `bun test` is the
  suite, `bun build --compile` is the release artifact.
- **`effect` v4** — a peer dependency, so your app and Foldcase share one Effect instance.
- **Node on `PATH`** — only for `foldcase test --coverage`, which is explained below.

Foldcase does *not* depend on Foldkit. The `play` thunk is opaque to the runner, so
Foldkit Showcases run in your app's own closure while Foldcase stays framework-blind.

```bash
bun add -d foldcase
```

> Foldcase is alpha. Any patch may break the public API. The package name and import path
> stay lowercase (`foldcase`) because npm forbids capitals; the tool is **Foldcase**.

## Writing a Showcase

A Showcase file is named `*.showcase.ts` and exports one array. There is no metadata
format to learn and no parse step — the array *is* the catalog.

```ts
import { Story } from "foldkit/testing"
import type { Showcase } from "foldcase"

import { ClickedButton, initialModel, Message, Model, update } from "./counter"

export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/click-twice",
    play: () =>
      Story.story(
        update,
        Story.with(initialModel),
        Story.message(ClickedButton()),
        Story.message(ClickedButton()),
        Story.model((model) => expect(model.clicks).toBe(2)),
      ),
    message: Message, // optional — the Message-union Schema
    model: Model, // optional — the Model Schema
  },
]
```

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

#### `--coverage`

Adds a V8 line and function coverage summary of the code each `play` actually executed —
per Showcase and in aggregate.

```bash
foldcase test src/ui --coverage
```

```
coverage:
  src/ui/Button.showcase.ts  lines 42/48 (88%)  fns 6/7 (86%)

1 file(s) · lines 42/48 (88%) · fns 6/7 (86%)

by showcase:
  ✓ button/default   lines 30/48 (63%)
  ✓ button/disabled  lines 24/48 (50%)
```

Coverage is **additive**: it never changes the pass/fail exit code, and if it cannot be
collected you get a warning, not a failure. It needs **Node on `PATH`** and runs from
source, because Bun exposes no programmatic V8 precise coverage — the measurement is taken
by a small Node instrument that Foldcase spawns.

### `foldcase docs` — Model and Message tables

Introspects each Showcase's `message` and `model` Schemas into JSON Schema, renders a
Markdown table per component, and writes one file per Showcase.

```bash
foldcase docs src/ui docs/schemas
foldcase docs                 # output goes to FOLDCASE_DOCS_DIR, default ./foldcase-docs
```

The Message table is `Message | Field | Type | Optional`, one row per tag and payload
field. The Model table is `Field | Type | Optional`. Types are readable rather than
literal: the `number | "NaN" | "Infinity"` encoding collapses to `number`, `Array<T>`
reads `T[]`, and a named class field resolves to its definition name. Output is sorted, so
regenerating gives a clean diff.

### `foldcase mcp` — the catalog for an agent

Serves the catalog to a coding agent over stdio MCP. Three tools:

| Tool | What it does |
|---|---|
| `foldcase_list_showcases` | Enumerate every Showcase, flagged with whether it carries a Message schema. |
| `foldcase_get_showcase_schema` | Introspect a Showcase's Message union into a JSON Schema document, so the agent builds a valid payload by construction. |
| `foldcase_run_showcase` | Run a Showcase's `play` and return the typed pass/fail report. |

```bash
foldcase mcp                                    # point your MCP host's stdio command here
FOLDCASE_SHOWCASE_DIR=src/ui foldcase mcp       # scan a specific directory
```

This is the **static** half of the loop: which Showcases exist, what their Messages look
like, and what happens when one runs. It composes with Foldkit's own devtools MCP, which
drives the **live** runtime. Together an agent can enumerate, read the schema, dispatch a
valid typed Message, assert the resulting Model, re-run the Showcase, and read a structured
result — with no DOM in the path.

## Programmatic use

| Import | What you get |
|---|---|
| `foldcase` | `Showcase`, `runShowcase`, `runShowcases`, the `ShowcaseReport` / `SuiteReport` Schemas, `formatSuite`, `suiteExitCode` |
| `foldcase/cli` | `discoverShowcaseFiles`, `loadShowcasesFromFiles`, `runSuiteFromFiles`, `docsFromFiles` |
| `foldcase/mcp` | the launchable stdio server Layer |

Every report is a decoded `Schema` value, not a loose object, so a failure is structured
data you can act on rather than a string you have to parse.

## Status

The `core` branch is the live line. The runner, the MCP server, the docs generator, and the
coverage collector are here with their history, and the two gates the decisions promised —
the toolchain fence and the derivation spine — run with the rest of the suite. The previous
line — an Openstory fork with a React shell, CSF-3 stories, and a Vite dev server — lives on
the `foldkit` branch and is not carried forward. See
[ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) first; it is short and it is binding for humans and agents
alike. Then:

```bash
mise run setup      # once, after installing
mise run test
mise run lint
mise run typecheck
```

## License

MIT. Foldcase began as a fork of [Openstory](https://github.com/millionco/openstory) and
keeps its copyright notice; [`NOTICE`](NOTICE) records exactly what is still derived from
it.
