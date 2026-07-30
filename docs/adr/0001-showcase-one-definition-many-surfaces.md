---
type: adr
title: A Showcase is defined once; every surface is derived from that definition
description: The Showcase record is the single definition of a component under test. The CI runner, the agent tools, the Markdown autodocs, coverage attribution, and the future browser lab are all projections of it — never a second, hand-written surface.
status: accepted
created: 2026-07-31
updated: 2026-07-31
---

# 0001 — A Showcase is defined once; every surface is derived

## Context

Foldcase serves several consumers of the same fact — "this component, in this state,
behaves like this":

- **CI** wants a pass/fail per component and a non-zero exit code.
- **An agent** wants to enumerate components, read a Message payload shape, and run one.
- **A reader** wants a table of the Model and the Message union.
- **A reviewer** wants to know which lines each component's test actually exercised.
- **A developer** wants to see the component render in a browser.

The Storybook family answers each of these with a separate addon, and each addon
re-derives its knowledge of the component from somewhere else: the DOM, a CSF-3 parse, a
`react-docgen` pass over the source, an untyped `fn()` spy. Five consumers, five
definitions of the same component. They drift by construction, and every new consumer
pays the extraction cost again.

The prior art for the alternative is BuilderIO's **agent-native** framework
(`github.com/builderio/agent-native`). Its core move is `defineAction`: the work is
defined once, with a schema and a `run`, and the UI, the agent tool surface, HTTP, MCP,
A2A, and the CLI are all *derived* from that one definition. Its own words: "Define work
once. Use it from UI, agent, API, MCP, A2A, and CLI." CosmOS applies the same rule to
backend capabilities in its ADR-0003 (one Schema-typed contract per module; every
transport is a projection).

Foldcase has the same shape of problem, so it takes the same answer.

## Decision

**A Showcase is declared once. Every Foldcase surface is a projection of that
declaration. No surface may build a second description of a component.**

The definition is one exported record:

```ts
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void> // throws on assertion failure
  readonly message?: Schema.Top // the Message-union Effect Schema
  readonly model?: Schema.Top // the Model Effect Schema
}
```

`play` is deliberately opaque. The runner never asks how it was produced — for a Foldkit
component it is a `Story` that dispatches typed Messages and asserts on the `Model`, and
it lives in the app under test, in that app's own closure. Keeping `play` a thunk is the
seam that lets the core stay framework-blind and testable without a DOM.

The surfaces, and what each one projects:

| Surface | Command | What it derives from the definition |
|---|---|---|
| **CI test runner** | `foldcase test` | Runs each `play`; reports a Schema-decoded `ShowcaseReport` per Showcase and a rolled-up `SuiteReport`; the exit code is the suite verdict. |
| **Agent tools** | `foldcase mcp` | `list` from the ids, `schemaFor` from `message`, `runById` from `play` — three Schema-typed MCP verbs, no hand-rolled JSON-RPC. |
| **Markdown autodocs** | `foldcase docs` | Introspects `message` and `model` into JSON Schema through the *same* path the MCP surface uses, then renders one table per component. |
| **Coverage attribution** | `foldcase test --coverage` | Measures V8 precise coverage around each `play`, so lines are attributed per Showcase and rolled up by union. |
| **Browser lab shell** | *not built yet* | Must also be a projection. When it lands, it renders from the declaration, not from a DOM crawl or a source parse. |

Two structural rules make this hold:

1. **One loader.** Every surface obtains its catalog through the single
   `loadShowcasesFromFiles` path in `src/cli.ts`. A surface never imports a
   `*.showcase.ts` module itself.
2. **One shape.** `Showcase` is declared in `src/runner.ts` and nowhere else. A surface
   that needs a new fact adds an **optional** field to the definition — as `message` and
   `model` were added — rather than inventing a private side-channel.

### Why this is stronger in Foldkit than in React

The rule is only worth adopting if the single definition is genuinely rich enough to
derive from. In React it is not: component state is scattered across hooks and refs, the
event surface is untyped callbacks, and rendering is not pure — so a surface has no
choice but to guess through the DOM. Foldkit removes all three obstacles:

- **The Model is one serializable value.** A surface can read the whole state at a point
  in time, and compare two of them, instead of scraping rendered text.
- **The Message union is an introspectable Effect Schema.** `Schema.toJsonSchemaDocument`
  turns it into a JSON Schema document, so an agent constructs a valid payload *by
  construction*. This is what replaces `react-docgen` — and it is better, because it is
  precise and available at runtime rather than recovered from source.
- **`update` is pure.** The same Messages give the same Model, so replay is exact and a
  derived surface is deterministic rather than flaky.

So in Foldkit a surface can be *derived*. In React it can only be *guessed at through the
DOM*. That is the whole reason this ADR is affordable here.

## Considered options

- **One module per surface, each with its own catalog format** (the Storybook addon
  model) — rejected: it is the drift this ADR exists to prevent, and it charges the
  extraction cost once per consumer.
- **CSF-3 metadata as the definition** (what the Openstory fork on the `foldkit` branch
  does) — rejected: CSF-3 is parsed from source, untyped, React-shaped, and cannot carry
  an Effect Schema. It cannot describe a Model or a Message union.
- **`react-docgen`-style static extraction** — rejected: it does not exist without React,
  and Schema introspection is strictly better (runtime, precise, already required).
- **Let each surface widen `Showcase` locally** — rejected: a local widening is a second
  definition wearing the first one's name.

## Consequences

- **Adding a surface is cheap and adding a parser is not allowed.** A new surface is a
  projection over `loadShowcasesFromFiles` plus a renderer. That is the intended cost.
- **Adding a field to `Showcase` is the expensive move, on purpose.** It must be optional
  and backward compatible; a Showcase that declares neither `message` nor `model` stays
  valid and is documented with a note rather than treated as a failure.
- **A surface cannot exceed the definition.** The browser lab will want a `view`; it must
  get one as a declared optional seam, not by reaching into the DOM. That constraint is
  the point, and it is the first thing to revisit when the lab is designed.
- **The core stays framework-agnostic even though the value is Foldkit-specific.** `play`
  is opaque, so Foldkit Showcases run in the app's own closure while the runner keeps no
  Foldkit dependency.
- **The MCP surface composes rather than competes.** `foldcase mcp` is the *static*
  catalog — which Showcases exist, their Message schema, run one. The Foldkit devtools
  MCP drives the *live* runtime. Together they close the loop: enumerate, read the
  schema, dispatch a valid Message, assert the Model, re-run.

## Enforcement

The mechanically-checkable clauses are gated, not left to review:

- **`test/surface-derivation.test.ts`** — a zero-dependency `bun test` (`bun:test` +
  `node:fs` only, importing no project code) that fails on:
  1. **A second shape** — the `Showcase` shape (an `id` + `play` pair) declared as an
     interface or type anywhere other than `src/runner.ts`.
  2. **A second loader** — a dynamic `import(` of a `*.showcase.ts` path in any file
     other than `src/cli.ts`, and any surface module under `src/mcp/`, `src/docs/`,
     `src/coverage/`, or a future `src/lab/` that reads showcase files directly.
  3. **A surface parser** — a source parse or DOM query used to recover component facts
     (`oxc-parser`, `fast-glob` over `*.stories.*`, `querySelector` on a canvas) in any
     surface module.
  4. **Exports drift** — every entry in `package.json` `exports` resolves to a file that
     exists, so a surface can never be published under a path that does not derive.
- **`mise run typecheck`** (patched `tsc`) — every surface consumes the single exported
  `Showcase` type, so a widening inside a surface fails to compile. This is the half a
  file-scanning test cannot see.
- **Judgment, not gated (by design):** whether a proposed new `Showcase` field is really
  needed by more than one surface, and whether a surface's output is *useful*. The gate
  can prove there is one definition; it cannot prove the definition is the right one.
