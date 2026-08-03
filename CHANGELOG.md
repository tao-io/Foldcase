# Changelog

Written by hand, in the shape of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major is 0, a minor may break something.

## [Unreleased]

Four defects a real consumer found. Foldkit's own component gallery was showcased with
this tool, and each of these is something it hit on the first run.

### Fixed

- **An argument the verb does not take stops the run.** `foldcase test a.showcase.ts
  b.showcase.ts` used to run the first path, exit 0 and say nothing about the second — and
  the one it dropped may be the catalog that will not load, so a CI job written that way
  passed forever over half its request. `test` takes one target, `docs` a target and an
  out-dir, `mcp` none; anything more prints the argument it did not understand, then the
  usage banner, and exits 1. Flags still sit on either side of the target.
- **A bin without its optional platform peer says which one to install.** Both
  `@effect/platform-*` packages are optional peers, so a consumer who installs only one
  used to meet `ERR_MODULE_NOT_FOUND` and a resolver stack trace before the CLI ran at
  all. Each shell now reaches for its package at runtime and, when it is missing, prints
  the package, the install command and the other bin, then exits 1. Any other resolution
  failure — a consumer's own missing module — is still reported as data.
- **A failed load names Node's type-stripping when that is the cause.** Node strips types
  but cannot tell a type-only import from a value import, so a showcase reaching a module
  that writes `import { Document } from 'foldkit/html'` failed with a bare `SyntaxError`.
  The loader now names the cause and the two ways out, and the README states the rule. One
  change in the single loader, so `test`, `docs` and `mcp` all say it.

### Changed

- **`foldcase docs` reads a real Model.** A union of tagged structs documents as its tags
  rather than as `object`, and an anonymous struct as its field list rather than `object`.
  Both are recognised by shape, not by annotation, so an Effect beta cannot move them. An
  inline struct stops at one level of nesting and five fields, because the cell is one line
  of a table.

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
- **`foldcase mcp`** — the catalog as an MCP server over stdio, with six read-only tools:
  list the Showcases, read a Showcase's Message schema or Model schema as JSON Schema, run
  one Showcase, run the whole catalog or one id prefix, and re-read the catalog from disk or
  point it at another directory. The catalog is loaded before the transport reads stdin, so
  the first `tools/list` answers in full.
- **`--json` on `test` and `docs`.** The run as one document — the report Schemas encoded,
  not a hand-built object — with coverage inside it when `--coverage` asks for coverage.
  stdout carries the document and nothing else; logs go to stderr; the exit codes do not
  move.
- **Every report names the file it came from.** An id does not say what to open, and the
  loader holds that fact, so it travels in the report rather than being declared on the
  `Showcase`. The MCP run verbs report it too.
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
