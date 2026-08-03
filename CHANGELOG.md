# Changelog

Written by hand, in the shape of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major is 0, a minor may break something.

## [Unreleased]

## [0.1.0] — 2026-08-04

The first release of the `core` line, published under the `alpha` dist-tag: install it as
`foldcase@alpha`. It is a new codebase. The Openstory fork it grew out of — the React
shell, the CSF-3 catalog, the framework adapters, the pnpm/turbo/vite toolchain — stays on
the `foldkit` branch and is not a dependency of this line. What carried forward is named
in [NOTICE](NOTICE): the play contract and the serialized-error shape.

### Added

- **The `Showcase` record**, in `src/runner.ts`. One component in one state, with a `play`
  that throws on a failed assertion. It is the only description of a component in the
  codebase, and every surface below is a projection of it
  ([ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md)).
- **`foldcase test [dir-or-file]`** — find every `*.showcase.ts` under a file or
  directory, run each Showcase headlessly, print a report and exit non-zero if one failed.
  A failing Showcase is data, not a crash, so one bad entry cannot decide the fate of the
  rest. Reports are Effect `Schema` values and survive a JSON round-trip.
- **`foldcase docs [dir] [out-dir]`** — one Markdown document per component, its Model and
  Message tables read out of the Schemas the Showcase declares. Nothing parses your source.
- **`foldcase mcp`** — the catalog as an MCP server over stdio, with three read-only tools:
  list the Showcases, read a Showcase's Message schema as JSON Schema, run one. The catalog
  is loaded before the transport reads stdin, so the first `tools/list` answers in full.
- **`foldcase test --coverage`** — line and function coverage of the code the plays really
  executed, tallied from V8 precise coverage. Bun exposes no programmatic precise coverage,
  so the measurement runs in a Node subprocess; the report names any file it could not
  measure rather than quietly scoring it zero.
- **Two bins over one core.** The whole CLI is a runtime-agnostic Effect that returns an
  exit code, and each runtime gets one thin shell: `foldcase` on Node and `foldcase-bun` on
  Bun. Both load a consumer's TypeScript without a build step
  ([ADR-0002 › Amendment 1](docs/adr/0002-bun-effect-foldkit-only.md)).
- **A published `dist/` built by `tsc`, with no bundler.** One `.js` and one `.d.ts` per
  source file, so Node, Vite and Bun all resolve it as ordinary ESM. The library entry
  points ship the `Showcase` type and the runner; `./cli`, `./mcp`, `./mcp/catalog` and
  `./mcp/tools` are public subpaths. Effect is a peer dependency, and both
  `@effect/platform-*` packages are optional peers, so a consumer installs only the one
  their runtime needs.
- **`examples/counter`** — a real Foldkit app with its own `package.json`, showcased by the
  built CLI under both runtimes on every push. Its committed documents are diffed against
  freshly generated ones, so the example cannot drift from what the tool writes.
- **The two ADRs, as gates.** `test/stack.test.ts` and `test/surface-derivation.test.ts`
  fail on a second Showcase shape, a second catalog loader, a surface that parses source, a
  rival lockfile or toolchain file, a banned framework, a bundler, and a `dist/` packed
  stale.

### Requirements

- Node 22.18.0 or later, or Bun 1.3.14 or later.
- `effect` 4.0.0-beta.90 or later, as a peer dependency.

[unreleased]: https://github.com/tao-io/foldcase/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tao-io/foldcase/releases/tag/v0.1.0
