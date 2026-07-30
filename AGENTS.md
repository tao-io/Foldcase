# Working rules — Foldcase

Binding for humans and agents. Short on purpose. The reasoning lives in
[`docs/adr/`](docs/adr/); this file is the rules that follow from it.

## The stack is fixed

- **Bun** is the runtime, the package manager, the test runner, and the bundler. Not npm,
  not pnpm, not Node, not Vite, not turbo.
- **Effect v4** for all non-trivial logic: typed errors, Layers, `Schema` for every
  contract. Not bare `async`/`throw`. Effect is a **peer dependency** — never promote it
  to a hard dependency, or a consumer ends up with two Effect instances.
- **Foldkit** is the only framework this line supports. **No React, no Solid, no Vue, no
  Svelte** — not in source, not in tests, not in devDependencies.
- **No CSF-3.** No `Meta`, no `StoryObj`, no `export default meta`, no `*.stories.ts`. A
  catalog is `export const showcases: ReadonlyArray<Showcase>` in a `*.showcase.ts` file.
- TypeScript only under `src/`. The single exception is `src/coverage/collector.mjs`, the
  Node V8 coverage instrument, which is allowlisted by name in the stack gate.

All of this is gated by `test/stack.test.ts` and by `eslint/no-restricted-imports` in
`.oxlintrc.json`. If you think you need an exception, change the ADR first.

## TDD is mandatory

No production code without a failing test first. Red, green, refactor — **one vertical
slice at a time**: one test, the smallest code that passes it, then the next. Never write
all the tests and then all the code.

- Tests are co-located (`foo.ts` next to `foo.test.ts`) and run on `bun test`.
- Test behaviour through the public interface, not implementation details.
- A test that needs to reach inside a module is a sign the interface is wrong.

## One definition, many surfaces

This is the spine of the codebase ([ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md)):

- The `Showcase` record in `src/runner.ts` is the **only** description of a component.
  Do not declare a second one, anywhere, for any reason.
- Every surface — the test runner, the MCP tools, the docs generator, coverage, a future
  lab — is a **projection** of that record. Surfaces do not parse source, crawl the DOM,
  or read `*.showcase.ts` files themselves.
- Every surface loads its catalog through `loadShowcasesFromFiles` in `src/cli.ts`. One
  loader.
- A surface that needs a new fact adds an **optional** field to `Showcase`, keeping older
  catalogs valid. Adding a field is a deliberate, reviewed act — not a shortcut.

## Effect conventions

- Read configuration through Effect `Config`, never `process.env`, outside `src/main.ts`.
- Log through `Effect.log*`, never `console`, outside `src/main.ts`.
- Decode with `Schema`; do not hand-roll `JSON.parse` over anything that crosses a
  boundary.
- Errors are tagged Schema classes with real payloads. A caught `unknown` at a boundary is
  normalised once, at that boundary, and the normaliser carries a comment saying why.
- `src/main.ts` is the imperative shell and the only place that touches `argv`, stdout,
  the exit code, and platform Layers. Everything else is pure logic behind an interface.
- A failing Showcase is **data**, not an Effect failure. The suite records it and carries
  on. Only a broken catalog — a missing or malformed file — is a typed failure.

## Before you commit

```bash
mise run lint        # oxlint
mise run typecheck   # patched tsc + @effect/language-service
mise run test        # bun test
```

All three must pass. CI runs the same three and nothing else, so a green local run is a
green CI run. Commit in small, logical steps with a message that says what changed and
why.

Run `mise run setup` once after installing — it patches `tsc` so the Effect language
service loads outside the editor. Without it, `typecheck` silently skips half its job.

## Layout

```txt
src/runner.ts     the Showcase record, runShowcase/runShowcases, the report Schemas
src/cli.ts        discovery + the single catalog loader
src/main.ts       the imperative shell: the `foldcase` bin
src/mcp/          the catalog MCP server (catalog service, tools, server Layer)
src/docs/         the Model/Message Schema-table generator
src/coverage/     `--coverage`: the collector contract, the tally, the Node instrument
test/             fixtures and the repo-wide gates (stack, surface derivation)
docs/adr/         the decisions, in numbered order
```

## What is not here

The React shell, the CSF-3 catalog, the framework adapters, and the Vite dev server are on
the **`foldkit`** branch, which tracks the Openstory fork this repository grew out of.
That branch is history, not a dependency. Do not merge it forward, and do not resurrect
pieces of it without amending
[ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md).
