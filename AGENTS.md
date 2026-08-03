# Working rules — Foldcase

Binding for humans and agents. Short on purpose. The reasoning lives in
[`docs/adr/`](docs/adr/); this file is the rules that follow from it.

## The stack is fixed

- **Bun** is the development toolchain: the package manager, the test runner, and the
  version `mise` pins. Not npm, not pnpm, not Vite, not turbo.
- **Node and Bun both run the shipped tool.** The core is runtime-agnostic Effect and each
  runtime gets one thin shell — `src/main.ts` (Node) and `src/main.bun.ts` (Bun). A shell
  binds a runtime, hands the program `process.argv`, and writes back the exit code;
  anything else in a shell is a bug. See ADR-0002 › Amendment 1.
- **The build is `tsc -b`, and there is no bundler.** `mise run build` compiles `src/` to
  `dist/` — one `.js` and one `.d.ts` per source file — and copies the coverage collector
  beside its caller. `bun build --compile` is not used and is not coming back: a compiled
  binary resolves `import(path)` inside its own `/$bunfs`, so it could never load an
  external `*.showcase.ts`, which is the whole job.
- **Effect v4** for all non-trivial logic: typed errors, Layers, `Schema` for every
  contract. Not bare `async`/`throw`. Effect is a **peer dependency** — never promote it
  to a hard dependency, or a consumer ends up with two Effect instances. Both
  `@effect/platform-*` packages are **optional** peers: a consumer needs only the one
  their shell runs, and the library entry points need neither.
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
- `src/program.ts` is the whole CLI as a runtime-agnostic Effect; it *returns* an exit code
  and names no runtime. The shells (`src/main.ts`, `src/main.bun.ts`) are the only places
  that touch `argv`, `process.exitCode`, and platform Layers.
- A failing Showcase is **data**, not an Effect failure. So is a `*.showcase.ts` that will
  not load: the loader returns what it read plus the files it could not, and each surface
  decides — `test` reports the file as a failed entry and exits non-zero, `docs` names it
  on stderr, `mcp` warns and serves the rest. One bad file must never decide the fate of
  the others (ADR-0001 › Amendment 2). Only a target that does not exist is a typed
  failure.
- `foldcase mcp` must answer the **first** `tools/list` with the whole toolkit. The stdio
  transport starts reading stdin the moment it is built, so anything slow — the catalog
  load above all — has to be built before it. Keep `FoldcaseCatalog` provided to the whole
  server graph, transport included.

## Before you commit

```bash
mise run lint        # oxlint
mise run typecheck   # patched tsc + @effect/language-service
mise run test        # bun test
mise run build       # tsc -b → dist/
mise run smoke       # drive the built dist/ under Node and Bun (after build)
```

All five must pass, and CI runs exactly these, so a green local run is a green CI run.
`smoke` is the only check that sees the *artifact* rather than the source: both bins, a
consumer's TypeScript resolving under each runtime, the coverage collector spawning out of
`dist/coverage/`, and the exit codes. `mise.toml` pins **Node 22.18.0** — the floor
`engines` claims — so none of this is tested against whatever Node the machine had.

Two further tasks run in CI rather than before every commit. `mise run dogfood` drives the
built CLI over `examples/counter`, a real Foldkit app. `mise run pack` packs the npm
tarball, checks what it holds, installs it into a temp directory and runs both bins from
there — the only check that sees what a consumer downloads. The release workflow, which a
`v*` tag triggers, runs all seven and then publishes under the `alpha` dist-tag.

Commit in small, logical steps with a message that says what changed and why.

Run `mise run setup` once after installing — it patches `tsc` so the Effect language
service loads outside the editor. Without it, `typecheck` silently skips half its job.

## Layout

```txt
src/runner.ts     the Showcase record, runShowcase/runShowcases/suiteOf, the report Schemas
src/cli.ts        discovery + the single catalog loader
src/program.ts    the whole CLI as a runtime-agnostic Effect; returns an exit code
src/main.ts       the Node shell: the `foldcase` bin
src/main.bun.ts   the Bun shell: the `foldcase-bun` bin
src/shell/        per-runtime policy (Node's TypeScript specifier resolution), unit-tested
src/mcp/          the catalog MCP server (catalog service, tools, server Layer)
src/docs/         the Model/Message Schema-table generator, one document per component
src/coverage/     `--coverage`: the collector contract, the tally, the Node instrument
test/fixtures/    catalogs the discovery suites load
test/malformed/   catalogs that must fail to load, and be reported for it
test/uncollectable/ a catalog Bun loads and the Node collector cannot
test/             the repo-wide gates (stack, surface derivation)
docs/adr/         the decisions, in numbered order
dist/             build output, gitignored
```

## What is not here

The React shell, the CSF-3 catalog, the framework adapters, and the Vite dev server are on
the **`foldkit`** branch, which tracks the Openstory fork this repository grew out of.
That branch is history, not a dependency. Do not merge it forward, and do not resurrect
pieces of it without amending
[ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md).
