# @cosmos/foldcase

The **Foldcase moat** as a CosmOS Effect-4 tool: the typed, deterministic
self-healing test loop. Storybook's loop pokes the DOM and reads untyped
callbacks; Foldcase's dispatches a typed Message from an introspectable Schema
and asserts on a deterministic, replayable Foldkit `Model`. Same loop, no
guessing, no flake.

This package is the Foldcase-native moat (Phase 1.1). It is built on the CosmOS
stack (Bun + Effect v4, `bun test`, oxlint + patched tsc gates), separate from
the openstory fork-core (`github.com/tao-io/Foldcase`, which stays pnpm/vite and
tracks upstream). Full plan: `/Users/tao/Projects/foldcase/docs/ai-native-roadmap.md` §5.

## `foldcase test`

Boots each **Showcase** headlessly, runs its `play`, and reports a
Schema-decoded pass/fail per Showcase plus rolled-up counts. Exit code is 1 on
any failure.

```bash
mise run foldcase:test          # the tool's own bun-test suite (G2 gate)
mise run foldcase:build         # compile the CLI → tools/foldcase/foldcase
./tools/foldcase/foldcase test <dir-or-file>   # run *.showcase.ts under a path
```

## `foldcase test --coverage` (Phase 3.9b — story-coverage)

Adds a **V8 line/function coverage** summary of the code each Showcase's
`play` actually executes (its `view`/`update` path), both **per-Showcase** and
**aggregate**. Coverage is **additive** — it never changes the run's pass/fail
exit code (that stays the suite's job); a collection failure degrades to a
warning.

```bash
mise run foldcase:test:coverage [showcase-dir]        # default `.`
./tools/foldcase/foldcase test <dir-or-file> --coverage
```

```
coverage:
  …/Button.showcase.ts  lines 42/48 (88%)  fns 6/7 (86%)

1 file(s) · lines 42/48 (88%) · fns 6/7 (86%)

by showcase:
  ✓ button/default   lines 30/48 (63%)
  ✓ button/disabled  lines 24/48 (50%)
```

**How & honest scope.** Bun exposes no programmatic V8 precise coverage
(node:inspector's Coverage domain is unsupported, `NODE_V8_COVERAGE` is ignored,
`bun:jsc.codeCoverageForFile` is broken), so `--coverage` spawns a small Node
instrument (`src/coverage/collector.mjs`) that runs the Showcases under Node's
inspector `Profiler` and imports the `.showcase.ts` files via Node's native
type-stripping. Consequences:

- **Node is required on PATH**, and `--coverage` **runs from source** — the
  collector is spawned, not bundled into the compiled `foldcase` binary.
- **Per-Showcase attribution is real:** each `play` is measured between precise-
  coverage takes; aggregate is the union of the per-Showcase results.
- Coverage is filtered to source files **under the target root** (excludes
  `node_modules`, the runner, and this tool's own files). A Showcase that only
  loads under Bun (Bun-specific APIs, DOM) won't be covered — the Bun suite still
  reports its pass/fail correctly.

## Authoring a Showcase

A Showcase is the seam between the runner and content — deliberately blind to
how the `play` is produced:

```ts
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void> // throws on assertion failure
  readonly message?: Schema.Top // optional Message-union schema (see `foldcase mcp`)
}
```

The optional `message` is the component's Message-union Effect Schema; the
`foldcase mcp` catalog server introspects it into a JSON Schema so an agent can
construct a valid typed Message. The optional `model` is the component's Model
Schema — its static peer, consumed by `foldcase docs` (below) to table the
Model. Both are absent for framework-agnostic showcases.

```ts
export interface Showcase {
  readonly id: string
  readonly play: () => void | Promise<void>
  readonly message?: Schema.Top // Message-union schema (see `foldcase mcp` / `foldcase docs`)
  readonly model?: Schema.Top // Model schema (see `foldcase docs`)
}
```

For a **Foldkit** component, `play` is a `Story` that dispatches typed Messages
and asserts on the `Model` (no DOM, no view). Because `Story` needs the
component's own closure (foldkit + its effect), Foldkit showcases live in the
app under test and run in its vitest closure. The canonical example is the
dogfood at `src/pwa/src/showcase/foldcase.dogfood.test.ts`:

```ts
const clickCounter: Showcase = {
  id: 'showcase/click-counter',
  play: () =>
    Story.story(
      update,
      Story.with(initialModel),
      Story.message(ClickedButton()),
      Story.message(ClickedButton()),
      Story.model((model) => expect(model.clicks).toBe(2)),
    ),
}
const report = await Effect.runPromise(runShowcase(clickCounter))
```

## Layout

- `src/runner.ts` — the framework-agnostic core: `Showcase`, `runShowcase`,
  `runShowcases`, the Schema `ShowcaseReport` / `SuiteReport`, the fork-compatible
  `SerializedError`, and `formatSuite` / `suiteExitCode`.
- `src/cli.ts` — `discoverShowcaseFiles` (walk a dir) + `runSuiteFromFiles`
  (dynamic-import modules; typed `ShowcaseModuleError` on a bad catalog).
- `src/main.ts` — the imperative shell: the `foldcase` bin (BunRuntime + platform
  layers, argv, stdout, exit code).
- `src/coverage/` — `--coverage` (Phase 3.9b): `coverage.ts` (the collector
  contract Schemas + the pure c8-style block-coverage `tallyFile`/`fileDetail`),
  `report.ts` (`buildCoverageReport` union + `formatCoverage`), `collect.ts` (the
  Effect subprocess collector, typed `CoverageCollectionError`), and
  `collector.mjs` (the Node V8 precise-coverage instrument).

## `foldcase mcp` (Phase 1.2)

The **catalog MCP server**: a real, Effect-native MCP server (built on
`effect/unstable/ai` — `Tool` + `Toolkit` + `McpServer.layerStdio`, no
hand-rolled JSON-RPC) exposing the story catalog to an agent. Three
`Schema`-typed verbs, wired to the `FoldcaseCatalog` service:

- **`foldcase_list_showcases`** — enumerate every Showcase, flagged with whether
  it carries an introspectable Message schema.
- **`foldcase_get_showcase_schema`** — introspect a Showcase's Message-union
  Effect Schema into a JSON Schema document, so an agent constructs a valid
  typed Message *by construction*. Fails typed (`ShowcaseNotFoundError` /
  `NoMessageSchemaError`).
- **`foldcase_run_showcase`** — run a Showcase's `play` headlessly and return the
  typed pass/fail `ShowcaseReport` (a failing play is `status: "failed"` carrying
  the serialized error, not a tool error; only an unknown id fails).

```bash
mise run foldcase:mcp                                     # serve over stdio (an MCP host's command)
FOLDCASE_SHOWCASE_DIR=src/pwa/src mise run foldcase:mcp   # scan a specific dir (Config)
```

It **composes with** the runtime `@foldkit/devtools-mcp` (already a dep of
`src/pwa`, 14 tools): this **catalog** server says *which* Showcases exist,
exposes their Message JSON Schema, and runs their `play`; devtools-mcp **drives
the live runtime** (`foldkit_dispatch_message` / `foldkit_get_model` /
`foldkit_replay`). Together they are the typed self-healing loop — enumerate →
read the Message schema → dispatch a valid typed Message → assert the
deterministic Model → run the Showcase → read the structured result → fix →
re-run.

- `src/mcp/catalog.ts` — the `FoldcaseCatalog` Effect service (`list` /
  `schemaFor` / `runById`), its typed errors, and the `FOLDCASE_SHOWCASE_DIR`
  `Config` loader.
- `src/mcp/tools.ts` — the `Tool.make` definitions + `Toolkit`, bound to the
  catalog via `makeHandlers`.
- `src/mcp/server.ts` — the launchable stdio server Layer (logs pinned to stderr;
  stdout carries the protocol).

## `foldcase docs` (Phase 3.8 — autodocs)

The **Model/Message Schema-table generator**: for each discovered Showcase it
introspects the `message?` (Message-union) and `model?` Effect Schemas into a
JSON Schema document — reusing the **same `Schema.toJsonSchemaDocument` path as
`foldcase mcp`** — and renders a Markdown table per component, then writes one
`<slug(id)>.md` per Showcase to an output directory.

- The **Message** table is `Message | Field | Type | Optional` — one row per
  `_tag` → payload field (a payload-less tag reads `_(no payload)_`).
- The **Model** table is `Field | Type | Optional`.
- Types are humanised: the `number | "NaN" | "Infinity" | "-Infinity"` encoding
  collapses to `number`, `Array<T>` reads `T[]`, a named `Schema.Class` field
  resolves to its `$ref` definition name, and the optional `null` branch is
  dropped (optionality is the `Optional` column). Output is **sorted** (showcases
  by id, fields by name, variants by tag) for deterministic diffs.
- A Showcase declaring **neither** schema is documented with a graceful note, not
  treated as a failure.

```bash
mise run foldcase:docs <showcase-dir> [out-dir]      # e.g. mise run foldcase:docs src/pwa/src docs/schemas
./tools/foldcase/foldcase docs [dir] [out-dir]       # out-dir defaults to FOLDCASE_DOCS_DIR (./foldcase-docs)
```

This tool delivers only the **Markdown Schema-table** part of Storybook-style
autodocs. **MDX and in-shell (in-browser) autodoc rendering are FORK-side**
(openstory, `github.com/tao-io/Foldcase`) and out of scope here — this CosmOS
tool emits clean, Allspark-friendly Markdown that a fork shell or a docs bundle
can embed.

- `src/docs/schema-table.ts` — the pure core: introspect + decode a Schema into a
  typed `JsonSchemaDocument`, extract `FieldDoc` / `MessageVariant` shapes, and
  render the Markdown tables. `SchemaIntrospectionError` on an un-introspectable
  schema.
- `src/docs/generate.ts` — `renderShowcaseDoc` (one titled doc per Showcase),
  `generateShowcaseDocs` (sorted), and `writeShowcaseDocs` (write `<slug>.md`
  files).
