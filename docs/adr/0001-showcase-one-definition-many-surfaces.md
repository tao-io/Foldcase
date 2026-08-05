---
type: adr
title: A Showcase is defined once; every surface is derived from that definition
description: The Showcase record is the single definition of a component under test. The CI runner, the agent tools, the Markdown autodocs, coverage attribution, and the browser lab are all projections of it — never a second, hand-written surface. Amendment 2 settles what a projection does with a file that will not load, and keys the docs surface on the component rather than the Showcase; Amendment 3 says what a component is; Amendment 4 moves a run into a fresh process, so what it reports is the code on disk; Amendment 5 adds the one fact a closure cannot be asked for — which Messages a play dispatches — so a surface can name the Showcases nobody has written; Amendment 6 gives the lab its one seam, a mount rather than the view this ADR predicted.
status: accepted
created: 2026-07-31
updated: 2026-08-04
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
  readonly dispatches?: ReadonlyArray<string> // the Message tags this play sends (Amendment 5)
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
| **Agent tools** | `foldcase mcp` | `foldcase_list_showcases` from the ids, `foldcase_get_showcase_schema` and `foldcase_get_showcase_model_schema` from `message` and `model`, `foldcase_run_showcase` and `foldcase_run_catalog` from `play`, `foldcase_load_catalog` from the one loader — six Schema-typed MCP verbs, no hand-rolled JSON-RPC. |
| **Markdown autodocs** | `foldcase docs` | Introspects `message` and `model` into JSON Schema through the *same* path the MCP surface uses, then renders one table per component. |
| **Coverage attribution** | `foldcase test --coverage` | Measures V8 precise coverage around each `play`, then reports one row per declared `Showcase` (see Amendment 1, 2026-07-31), rolled up by union. |
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
     other than `src/cli.ts` and the one loader declared in Amendment 1, and any surface
     module under `src/mcp/`, `src/docs/`, `src/coverage/`, or a future `src/lab/` that
     reads showcase files directly.
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

## Amendment 1 — 2026-07-31: the coverage surface

Porting Foldcase to a Node-runnable distribution ([ADR-0002](0002-bun-effect-foldkit-only.md)
› Amendment 1) surfaced two places where `--coverage` did not keep the promise this ADR
makes for it. Both are settled here. The decision above is unchanged; this section says
what it means for the one surface that runs outside the Effect world.

### 1. The coverage collector is a second loader, and stays one

`src/coverage/collector.mjs` dynamically imports the `*.showcase.ts` files it is handed.
The Enforcement section forbade that and granted no exception for it, so the gate carried
the exception instead of the ADR — a rule that lives only in its own test.

**Decision: the process boundary is a declared exception. The collector keeps its import.**

The alternative — hand the collector a loaded catalog instead of file paths — cannot be
built. A `Showcase` is `{ id, play }` and `play` is a *closure* (ADR-0001 › the seam that
lets the core stay framework-blind). A closure does not serialize, so it cannot cross a
process boundary as data. And the measurement is only meaningful *inside* the instrumented
process: V8 precise coverage records what the inspector saw the running process execute,
so the play must be called under Node's `Profiler`, not called here and reported there.
The second import is therefore structural, not convenience.

The exception is bounded, and the boundary is what the gate checks:

- **exactly one file** — `src/coverage/collector.mjs`, pinned by
  `test/surface-derivation.test.ts` (`DECLARED_SECOND_LOADER`), the same file
  ADR-0002 already names as the single non-TypeScript source;
- **it does not decide the catalog** — the file list still comes from the one loader, and
  since this amendment the report's per-Showcase rows are projected from the loaded
  `Showcase` records (below), so the collector can only *attribute* coverage, never
  invent, rename or drop a Showcase.

### 2. `--coverage` now really is a projection of the record

The table above claimed `--coverage` derives from the `Showcase` record, but `src/coverage/*`
never imported the `Showcase` type: it attributed coverage by a bare `id: string` read back
out of the collector's JSON. The claim was false, and the cost was real — a Showcase whose
file the collector could not import simply vanished from the report, leaving a partial
report that looked complete.

**Decision: make it derive, rather than correct the table.**

`buildCoverageReport(raw, showcases)` and `collectCoverage(root, files, showcases)` now take
the catalog the one loader already produced, and the per-Showcase breakdown is built by
walking those records:

- every declared Showcase gets a row, in declaration order;
- a Showcase the collector skipped shows up as `no coverage collected` instead of
  disappearing (its `0/0` would otherwise round to 100%, the one number that must never
  stand for "not measured");
- an id the catalog does not declare is dropped.

`foldcase test` loads the catalog once and hands the same records to the runner and to
coverage, so the two surfaces can no longer disagree about which Showcases exist. The
positive half of `test/surface-derivation.test.ts` now lists `src/coverage/collect.ts` and
`src/coverage/report.ts` among the modules that take `Showcase` from `src/runner.ts`, which
is the mechanical form of this claim.

## Amendment 2 — 2026-07-31: a file that will not load, and what a doc is keyed on

A dogfooding pass over real Foldkit components found two places where the surfaces did
less than this ADR promises. Both are settled here. The decision above is unchanged.

### 1. A load failure is data, like a failing play

The ADR says a failing Showcase is a datum and only a broken catalog is a typed failure.
In practice "a broken catalog" meant *one* file with a bad import, and the typed failure
aborted the run before any other file was even attempted. Pointed at a directory of 25
Showcases with one unimportable module, `foldcase test` reported nothing at all.

**Decision: a file that will not load is reported, not fatal.** `loadShowcasesFromFiles`
returns what it read *and* the failures beside it, and each surface decides:

- **`foldcase test`** reports the file as a failed entry keyed by its path, ahead of the
  Showcases that ran, and the suite verdict stays non-zero.
- **`foldcase docs`** writes the documents it could and names the skipped files on stderr,
  exiting non-zero.
- **`foldcase mcp`** logs a warning and serves the rest: an agent losing one module is
  better than an agent losing the catalog.

Only a *target* that does not exist is still a typed failure, because there is nothing to
partially succeed at.

### 2. A doc is keyed on the component, not on the Showcase

`foldcase docs` wrote one file per Showcase, so a component with five Showcases produced
five documents identical below the title. The Showcase is the unit of *testing*; the
component is the unit of *documentation*, and the ADR's own table says the docs surface
"renders one table per component".

**Decision: a component is the set of Showcases that declare the same `message` and
`model`.** (Superseded by Amendment 3, 2026-08-04: this rule collapsed on a real Foldkit
app, and the component is now the id namespace.) In a real showcase file that is exactly
the Showcases of one component, because they share the declared schema objects — so the
grouping is derived from the record, not from a naming convention. The document is named
after the `/`-separated id namespace its Showcases share (`ui/picker/*` → `ui-picker.md`)
and lists the ids it came from. Showcases that declare *neither* schema are never merged:
having nothing to say is not a component.

This changes output filenames, which is a breaking change for anyone linking to them.

### 3. The docs surface reads the decoded side

The tables introspected the *encoded* schema, so a Model field declared
`Schema.DurationFromMillis` documented as `number` and `Schema.Duration` as `object`. A
Model table exists to say what the Model holds. `src/docs/schema-table.ts` therefore
introspects `Schema.toType(schema)` and asks `toJsonSchemaDocument` to carry the `expected`
annotation — the declared type's name, through a supported option rather than a reach into
the Schema AST. `foldcase mcp` still serves the plain encoded JSON Schema, because an agent
constructing a payload needs the wire form. Two projections of one declaration, which is
what this ADR asks for.

## Amendment 3 — 2026-08-04: a component is an id namespace

Amendment 2 keyed a document on **the set of Showcases that declare the same `message` and
`model`**. Schema object identity was chosen because it reads the grouping out of the
record instead of out of a naming convention, which is what this ADR asks a surface to do.
It held for the fixtures, where each component file declares its own schemas. It collapsed
on the first real Foldkit app it met.

A Foldkit app has **one** Model struct and **one** Message union for the whole app; a
component is a slice of them, so every Showcase in the app declares the same two objects.
Schema identity therefore answered "one component" for the whole app: 146 Showcases across
24 components wrote a single 15 KB document, titled after an arbitrary Showcase and
listing every id in one paragraph. The rule was right that a naming convention is weaker
evidence than the record; it was wrong about what a real app's record says.

**Decision: a component is an id namespace — everything before the last `/` of the id.**
`button/starts-unclicked` and `button/counts-one-click` are the `button` component,
`ui/picker/initial` is `ui/picker`, and an id with no `/` is its own component.

This is not a new description of a component. It is the one the tool already ran on:
`foldcase_run_catalog` narrows a run with an `id_prefix` like `counter/`, so what one
surface filters on, the other titles. It is also stable whatever the app's schemas look
like, which Schema identity was not.

Asking the app for a narrower per-component Schema was the alternative, and this ADR
forbids it: a schema declared to satisfy the docs surface is a second description of a
component wearing the first one's name, and it would drift from the Model the app really
updates.

Filenames and the `Showcases:` list are unchanged — the document was already named after
the namespace. Two rules follow from a group no longer sharing one declaration:

- **Each table is read from the first Showcase, in id order, that declares that Schema.** A
  namespace may hold plain update-logic Showcases beside schema-carrying ones, and two
  siblings may declare different objects. The earliest wins rather than the run failing
  over a disagreement an app is entitled to; the listed ids say where else to look.
- **A component whose Showcases declare neither schema gets no document.** The Consequences
  above say such a Showcase is "documented with a note"; since this amendment it is `none`.
  A page whose only content is a note that there is nothing to say costs a reader more than
  no page. The Showcase stays valid and still runs, which is what that clause protected.

## Amendment 4 — 2026-08-04: a run reads the disk

`foldcase mcp` held its catalog in memory and ran a `play` in its own process. Both
runtimes cache an ES module by URL, so once a `*.showcase.ts` had been imported, importing
it again handed back the module that was already there. An agent that fixed a component,
called `foldcase_load_catalog` and ran the Showcase read a report of the code it had just
replaced — and concluded the fix had not worked. The reload verb could not help: it
re-imports the same URL.

**Decision: the two run verbs run in a fresh child process of the current runtime.**
`foldcase_run_showcase` and `foldcase_run_catalog`, over a catalog read from a directory,
walk that directory again, hand the files to a child spawned on `process.execPath`, and
decode the one JSON document the child writes on stdout. The child has imported nothing
before, so what it runs is what is on disk. An in-memory catalog (`layerFromShowcases`)
keeps the in-process path — a `play` is a closure, and a closure cannot be handed to a
process that never saw the module holding it, which is the same structural reason
Amendment 1 gives for the coverage collector.

This ADR is untouched by it, in the three ways that matter:

- **The record is still the single description.** The child reads it with the one loader,
  `loadShowcasesFromFiles`, in another process. It is not a second loader in the sense the
  gate fences: it imports no path of its own choosing — the parent's directory walk, also
  `src/cli.ts`, decides which files it is handed.
- **One function decides what a run means.** `runSelection` in `src/mcp/freshRun.ts` takes
  a loaded catalog and a selection, and the in-process path and the child both call it. So
  crossing a process boundary changes where the catalog was read and nothing else: a
  failing play is still data, a report still names its file, a prefix run still folds in
  every load failure, and both errors still carry the ids they could have matched.
- **Nothing new crosses the boundary.** The document the child writes is built from the
  report Schemas `src/runner.ts` already declares. `src/mcp/freshRun.ts` is on the list of
  modules that derive from the definition, for that reason.

What does **not** cross the boundary is a Schema: it is a live object, so
`foldcase_list_showcases`, `foldcase_get_showcase_schema` and
`foldcase_get_showcase_model_schema` still answer from the module this process imported.
`foldcase_load_catalog` refreshes them for a file that appeared or vanished; a Schema
edited inside a file that was already loaded needs a restart. The tool descriptions say
so — an agent reading them has to know which answers it can trust after an edit, and the
honest split is: runs, always; metadata, until the file was first imported.

The cost is a process per run. That is the right trade for an agent loop, where the
alternative is a wrong answer that costs a turn to discover and often is not discovered
at all.

## Amendment 5 — 2026-08-04: a Showcase declares which Messages it dispatches

Every surface so far answers a question about the Showcases that exist. The question an
agent asks before it writes one is the opposite: **which Messages of this component's
union does no Showcase ever send?** Each answer is a Showcase somebody still has to
write, which makes it the most useful thing this catalog can say to an agent — and
nothing here could say it.

Observing it is not available. `play` is an opaque closure, which is the seam the whole
ADR rests on: the runner never learns what a play did, only whether it threw. Watching a
dispatch would mean either a Foldkit dependency in the core or a source parse of the
play, and the second is exactly what the Enforcement section forbids.

**Decision: `Showcase` gains an optional `dispatches?: ReadonlyArray<string>` — the
Message tags this play sends, declared by the author and validated against `message`.**

- **Declared, not observed.** The author says what the play dispatches. That is a claim,
  and this ADR does not take claims on trust, so:
- **Validated against the union.** A declared tag the component's Message Schema does not
  carry is reported as `unknown` wherever a gap is shown, and `foldcase docs` exits
  non-zero for it — the same class of failure as a Schema that will not introspect,
  because both mean the declaration disagrees with the definition. A *gap* is not a
  failure: a Message nobody showcases yet is information, and the run stays green.
- **Unknown is never coverage.** A component whose Showcases declare nothing is reported
  nowhere at all, rather than as a component with an empty gap. An empty gap means "every
  Message is showcased" and must keep meaning only that; a single array could not tell
  the two apart, so absence carries one of them.
- **An empty declaration is a declaration.** `dispatches: []` says the play sends nothing,
  which is a fact about it; an absent field says nobody has looked.

The derivation is one function, `componentGaps` in `src/docs/generate.ts`, and both
surfaces import it: `foldcase docs` prints `Not showcased:` and `Unknown dispatches:`
under a component's Messages table and carries the same lists in its `--json` document,
and `foldcase_list_showcases` answers with a `gaps` entry per component. It lives beside
the docs surface because a gap is keyed on a *component*, and Amendment 3 put the
definition of a component — the id namespace — there. It reads its tags out of
`messageVariants`, the extraction that renders the Messages table's first column, so a
table and a gap can never disagree about which Messages exist.

The field is optional, so every catalog written before this amendment stays valid and
reports no gap, which is the honest answer for it. The loader holds it to its shape — a
`dispatches` that is not a list of strings makes the file malformed, exactly as a
`message` that is not an Effect Schema does — so a surface reading it can never be handed
something else.

## Amendment 6 — 2026-08-04: the lab's seam is a mount, not a view

Building the browser lab ([ADR-0004](0004-the-lab-is-a-foldkit-app-the-consumer-builds.md))
reached the row this ADR left marked *not built yet*, and with it the seam the Consequences
above reserved. The decision above is unchanged; this section adds the one optional field
the lab needs, and says why it is not the field this ADR expected.

**Decision: `Showcase` gains one optional field, `mount`.**

```ts
readonly mount?: (container: HTMLElement) => Teardown | Promise<Teardown>
// type Teardown = () => void
```

### Why a mount and not a `view`

The Consequences say the lab "will want a `view`; it must get one as a declared optional
seam". It cannot have one. Foldkit makes a `view` alone unrenderable, and this is where
that is written down:

- **A Foldkit `view` is `(model, h: HtmlBuilder<Message>) => Html`.** The builder is
  invariant in `Message`, and application code cannot construct one — it arrives as the
  view's own argument. So a lab holding a view has nothing to call it with.
- **There is no `Html.map`.** A lab cannot lift a view typed in an unknown app's Message
  union into its own view, so even a callable view could not join the lab's tree. Embedding
  is the only route Foldkit offers.
- **`story()` returns `void`.** A play yields no model, so even given a callable view there
  would be nothing to feed it.

The seam that renders is therefore the one Foldkit already offers a host:
`Runtime.embed(Runtime.makeElement({ … }))` returns an `EmbedHandle` whose `dispose` is the
teardown. `mount` is that shape. It is also the direct analogue of `play` — an opaque thunk
whose content lives in the app's own closure — which is what keeps the record
framework-agnostic while the value inside it is Foldkit's.

### Backward compatible, as the rule requires

The field is optional and every catalog written before it stays valid. A Showcase without
`mount` is listed, run, tabled and measured exactly as before, and gets no canvas in the
lab. That is the record's answer, not a defect: the lab may not guess a view from an id,
parse the source, or crawl the DOM (Enforcement, clause 3). A Showcase with nothing to draw
draws nothing.

`mount` present but not a function is a **malformed module** — the same rule `message` and
`model` already carry. The one loader refuses the file and reports it as a load failure
(Amendment 2), so a bad `mount` costs its own file and no other.

### Two facts the contract carries

Both measured against a live Foldkit runtime, and both are why `mount` takes a container
rather than returning a node:

- **`Runtime.embed` replaces the element it is handed.** A caller passes a fresh child slot
  it created inside `container`, never a node its own virtual DOM diffs, or the host's next
  patch and the embedded runtime fight over the same node.
- **A Foldkit runtime dies if its container has no `id`, silently, because `embed` forks.**
  The failure lands in a forked fiber, so nothing throws where the caller can see it. The
  slot the lab creates carries an id.

### How the lab reaches the DOM

Enforcement clause 3 bans a DOM query in a surface, and `mount` needs a live `HTMLElement`.
The lab does not query the document. Foldkit's `Mount.define`, with the `OnMount` and
`OnUnmount` attributes, hands application code the element itself, and the Mount's scope is
that element's lifetime — so the teardown is an `Effect.acquireRelease` finaliser rather
than a listener somebody must remember to remove. The gate is satisfied by construction,
not by evasion.
