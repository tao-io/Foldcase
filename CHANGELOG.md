# Changelog

Written by hand, in the shape of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major is 0, a minor may break something.

## [Unreleased]

Five defects a real consumer found. Foldkit's own component gallery was showcased with
this tool, and each of these is something it hit on the first run.

### Fixed

- **`foldcase docs` writes one file per component, on a real app.** A component was the
  set of Showcases declaring the same `message` and `model` objects. A Foldkit app has one
  Model struct and one Message union for the whole app, each component a slice of them, so
  the gallery's 146 Showcases across 24 components wrote a single 15 KB document, titled
  after an arbitrary Showcase and listing every id in one paragraph. A component is now
  the id namespace — everything before the last `/` — which is what
  `foldcase_run_catalog` already filters on, so the same app writes 24 files named
  `button.md`, `calendar.md` and the rest. Asking the app to declare a narrower
  per-component Schema was not the fix: that is a second description of a component, which
  [ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md) forbids. Each table
  is read from the first Showcase in id order that declares it, and a component that
  declares neither Schema now gets no file rather than a page saying so.
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
- **The stack gate reads every manifest, not just the root one.** The banned-package and
  bundler checks looked at `package.json` alone, so a nested manifest could have declared
  React or Vite unseen. They now walk every manifest in the repository. This tightened the
  fence in the same change that opened its one hole, below.

### Added

- **The browser lab, `foldcase/lab`.** A Foldkit application that renders a catalog: it
  groups the Showcases by component — the id namespace, the same rule `foldcase docs` and
  an MCP `id_prefix` already run on — says what each Showcase declares, names beside the
  gallery the files that would not load, and draws the component of any Showcase that
  declares a `mount`. It is a library, not a server. No bundler runs in this repository
  for it: the entry module it ships with is built by the consumer's own Vite, the one a
  Foldkit app already runs for `@foldkit/vite-plugin`
  ([ADR-0004](docs/adr/0004-the-lab-is-a-foldkit-app-the-consumer-builds.md)).
- **The lab holds a real catalog on one screen.** Run over the gallery's 146 Showcases the
  first shell scrolled the whole page: the sidebar stood 6766 pixels tall, so selecting
  anything past the second component pushed the details panel off screen, and reading what
  you had just clicked meant scrolling back up six thousand pixels. Each column now scrolls
  itself, the selected row scrolls into view — through Foldkit's Mount, which hands the lab
  the element, rather than a query the surface gate rightly forbids — and a component folds
  to one row. The whole sidebar folds from 7021 pixels to 1438.
- **The lab filters, and the arrow keys walk what the filter left.** A filter answers
  "which Showcase", where a fold could only ever answer "which component", and a catalog of
  a few hundred had no other way in than scrolling it. The sidebar carries a filter over
  the ids, sticky above a list that no longer scrolls out from under it, saying how many of
  the catalog it is showing; a live filter opens every group it matched, because a filter
  that hid its own hits behind an old fold would lie about the catalog. `↑` and `↓` move
  between the rows on screen and stop at the ends rather than wrapping, and the chosen row
  is the only one in the tab order — reaching the canvas by keyboard took 171 presses and
  now takes two.
- **The fold no longer swallows the click on the component you are looking at.** It used to
  record the fold and apply it later, when the reader had moved on and the sidebar
  reshuffled under them: a click with no feedback, then a movement with no cause. The fold
  is immediate now, and arriving at a Showcase opens the component it belongs to instead —
  so a deep link, a back button and an agent's dispatch all land on a row that is on
  screen, which is what the old rule was protecting.
- **The lab draws as an instrument.** A design critique of the shell scored it 16 of 40
  and named the cause: the whole chrome was one type size, so hierarchy came from three
  greys, and the largest text in the viewport belonged to the component under test. The lab
  now draws on a tinted ground with its own surfaces on white, so the boundary around a
  live component is a change of surface rather than the 2px dashed rectangle that used to
  mark it at 1.48:1 — the mark every other interface uses for a placeholder. The id is a
  heading split at its last slash; the three seams are chips whose words carry the fact,
  where a column of `true` with one `false` in it was scanned by shape; the state most
  catalogs are in most of the time is an empty state in the canvas's own geometry rather
  than an unstyled sentence in a white void; and the files that would not load sit at the
  head of the sidebar, where the reader is when they wonder why a component is missing,
  rather than seven thousand pixels below it. No text is under 4.76:1, the focus ring on
  the chosen row is white over the fill rather than blue over blue, the group headings
  stick so a leaf name always has its namespace, the tab title names the Showcase, and
  below 880px the two columns become two rows instead of clipping the component off the
  right edge.
- **`mount`, the one seam the lab needed on `Showcase`.**
  `(container: HTMLElement) => Teardown | Promise<Teardown>`, optional, so every catalog
  written before it stays valid. A Showcase without it is listed, run and tabled exactly as
  before, and gets no canvas.
  [ADR-0001](docs/adr/0001-showcase-one-definition-many-surfaces.md) expected a `view`
  here, and Foldkit cannot give a host one: the builder a view takes is invariant in the
  app's Message union and there is no `Html.map`, so embedding is the only route Foldkit
  offers. `mount` is the shape of `Runtime.embed`, and it is opaque for the same reason
  `play` is — the closure lives in the app under showcase, so the record stays
  framework-agnostic.
- **`foldcase lab [dir] [entry]`** — writes the entry module the lab starts from, then
  stops. It bundles nothing, serves nothing and starts no watcher. `--json` prints the
  catalog the lab renders beside the path it wrote, so an agent reads the gallery without
  opening it; `--check` writes nothing and exits non-zero when the entry on disk is missing
  or would change, the drift gate `docs --check` already carries.
- **`foldkit` as an optional peer dependency** — the first time this line declares Foldkit
  at all. Only `foldcase/lab` needs it, and an entry point nobody imports is never
  resolved, so a consumer of `foldcase test` is never asked for it.
- **An address per Showcase: `?showcase=<id>`.** A Showcase id is a URL. A reader clicks an
  entry and copies the address out of the bar; an agent builds the same address from an id
  `foldcase_list_showcases` already served, opens it in whatever browser it can already
  drive, and screenshots the drawn state. No new tool, no new dependency, and nothing added
  to the tarball.
- **No MCP tool for the lab, and that was measured rather than assumed.** Each mounted
  Showcase is its own Foldkit runtime and registers with Foldkit's own devtools bridge, so
  `@foldkit/devtools-mcp` listed the lab and the mounted Showcase separately and its verbs
  reached both. The lab hands devtools its own Message union, which is what lets
  `foldkit_dispatch_message` select a Showcase — `SelectedShowcase({ id })` — by the ids
  the catalog already serves.
- **Two Foldkit behaviours the `mount` contract now names, both measured against a live
  runtime.** `Runtime.embed` *replaces* the element it is handed, so a host passes a fresh
  slot it created rather than a node its own virtual DOM diffs — otherwise the host's next
  patch and the embedded runtime overwrite the same node. And a Foldkit runtime dies if its
  container carries no `id`; it dies silently, because `embed` forks and the failure lands
  in a forked fiber where the caller cannot see it. The slot the lab creates is fresh and
  carries an id.
- **A documentation site, in this repository, at `docs/site/`.** It is a
  [foldocs](https://github.com/tarkaworks/foldocs) application — Foldkit and Effect, the
  same line this tool is written for — and every page of it is *derived* from `README.md`,
  `CHANGELOG.md` and `docs/adr/` on each build. The generated pages are gitignored, so the
  prose has one home and cannot fork. `mise run docs:dev` serves it, `mise run docs:build`
  writes `docs/site/dist/`, and `mise run docs:deploy` puts it on Cloudflare through
  alchemy. None of this is in the seven CI checks, and nothing of it reaches the npm
  tarball. foldocs builds with Vite, which [ADR-0002](docs/adr/0002-bun-effect-foldkit-only.md)
  had fenced out entirely; [ADR-0003](docs/adr/0003-the-documentation-site-lives-here.md)
  records why the site is here rather than in a second repository — a second one would
  either copy the prose or derive it across a pin that lags, and this tool exists to say
  that one definition should have many surfaces, not many copies.
- **The dogfood is a real consumer now, vendored at `dogfood/gallery`.** `examples/counter`
  is eight Showcases we wrote, so it can only find what we already thought to look for; the
  five defects above came from Foldkit's own component gallery, an application we did not
  write. It is here as a git submodule pinned to a commit — 24 `@foldkit/ui` components,
  one page each, 146 Showcases over one shared Model, one Message union and one `update` —
  and `mise run dogfood:gallery` drives the built CLI over it under both bins and checks
  the lab document counts what the run produced. What the exception costs is written down:
  the gallery carries `vite`, `vitest` and configs for both, so
  [ADR-0005](docs/adr/0005-the-dogfood-is-a-vendored-consumer.md) declares `dogfood/` out
  of the stack gate's scope rather than allowing pieces of it. Nothing there is built,
  linted, typechecked, shipped or edited, no bundler runs here for it, no manifest of ours
  gains a package, and the task is in none of the seven checks, so a moved pin cannot
  redden a release. A clone without submodules passes everything regardless.

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
