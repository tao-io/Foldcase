---
type: adr
title: This repository is Bun + Effect-4 + Foldkit only; the Openstory fork line stays behind
description: The core line drops the React shell, CSF-3, and the pnpm/turbo/vite toolchain. They remain on the foldkit branch as history. The accepted cost is that a Bun-only artifact narrows the audience, since the Foldkit community runs Node + Vite + npm/pnpm.
status: accepted
created: 2026-07-31
updated: 2026-07-31
---

# 0002 — Bun + Effect-4 + Foldkit only; the fork line stays behind

## Context

This repository started as tao-io's fork of `millionco/openstory` (MIT): a
framework-agnostic component explorer built on pnpm workspaces, turbo, Vite, a prebuilt
React shell, and CSF-3 story files, with adapters for React, Solid, Vue, Svelte, and
Foldkit. That line is on the `foldkit` branch (over `main`, which tracks upstream).

Meanwhile the part that carries the value — the headless runner, the MCP catalog server,
the Schema-table generator, the coverage collector — was written separately as a Bun +
Effect-4 CLI: about 1300 lines of source and 1100 of tests, 40 passing `bun test`s, no
DOM, no Vite, no React. It became clear that the CLI is Foldcase, and the shell is
scaffolding around it.

Carrying both forward means carrying two package managers, two test runners, two build
systems, and two definitions of a component (CSF-3 metadata and the `Showcase` record of
ADR-0001). That is a permanent tax on a small project.

## Decision

**The `core` line is Bun + Effect-4 + Foldkit. Nothing else is carried forward.**

In scope:

- **Bun** — the runtime, the package manager, the test runner (`bun test`), and the
  bundler (`bun build --compile` produces the single `foldcase` binary).
- **Effect v4** — all non-trivial logic. Typed errors, Layers, `Schema` for every
  contract. Effect is a **peer dependency**, so a consumer and Foldcase share one Effect
  instance.
- **Foldkit** — the only framework this line supports. Foldcase declares no dependency on
  it (`play` is opaque, per ADR-0001), but every design choice assumes Foldkit's
  serializable Model, typed Message union, and pure `update`.
- **TDD** — no production code without a failing test first, one vertical slice at a
  time. Tests are co-located and exercise public interfaces.

Explicitly **not** carried forward, and staying on the `foldkit` branch:

- the prebuilt **React shell** and the `/__openstory/*` runtime plumbing;
- **CSF-3** (`Meta` / `StoryObj`, `export default meta`) and the story-file parser;
- the **React, Solid, Vue, and Svelte adapters** (`foldcase/react` and friends);
- **pnpm workspaces, turbo, and Vite**, including `pnpm-workspace.yaml`, `turbo.json`,
  and the root `vite.config.ts`;
- **Vitest**, **Playwright**, and the visual-snapshot gate built on them.

The component-file suffix is `*.showcase.ts`, not `*.stories.ts`. The catalog is a plain
`export const showcases: ReadonlyArray<Showcase>` — no default export, no parse step.

### The one declared exception

`foldcase test --coverage` spawns **Node**. Bun exposes no programmatic V8 precise
coverage — `node:inspector`'s Coverage domain is unsupported, `NODE_V8_COVERAGE` is
ignored, and `bun:jsc.codeCoverageForFile` is broken — so per-Showcase attribution runs
under Node's inspector `Profiler` via a small `.mjs` instrument that is *spawned, not
bundled*. Consequences, stated plainly rather than hidden:

- `--coverage` needs **Node on PATH** and runs **from source**, so it does not work from
  the compiled binary.
- `src/coverage/collector.mjs` is the only sanctioned non-TypeScript, non-Effect source
  file in the repo. It is named in the lint ignore list and in the stack gate's allowlist,
  so it is an exception by declaration, not by accident.
- Coverage is **additive**: it never changes the run's pass/fail exit code, and a
  collection failure degrades to a warning.

## Considered options

- **Keep both toolchains in one repo** (a Bun package next to the pnpm workspace) —
  rejected: two package managers and two test runners in one tree, and the CSF-3 catalog
  would remain a second definition of a component, breaking ADR-0001.
- **Port the shell to Bun and keep the React UI** — rejected: the React shell is the
  largest piece of the fork and the least aligned. If a browser lab is wanted, it should
  be a Foldkit app, which is already the fork's own roadmap item.
- **Leave the CLI where it was written, inside its host repo** — rejected: it has three
  commands, a public API, and an outside audience; it needs its own release line, its own
  issues, and its own README.
- **Ship a Node-compatible build alongside the Bun one** — not rejected, deferred. See
  the open questions.

## Consequences

- **The audience narrows, and this is the real cost.** The Foldkit community runs Node +
  Vite + npm/pnpm. A Bun-only artifact — `bin` pointing at a `.ts` entry, `exports`
  pointing at `.ts` source, `bun:test` in the suite — is installable by Bun users and
  awkward for everyone else. **Accepted for now**, because the alternative is a
  transpile-and-publish pipeline before the code has any users. It is the first thing to
  revisit if adoption stalls.
- **The published `foldcase` package changes shape.** Anyone importing `foldcase/foldkit`,
  `foldcase/react`, or running `foldcase dev` is on the fork line (`0.1.x`) and must stay
  there or migrate. This is a breaking change for existing consumers of the tarball, and
  the version numbering must say so.
- **Effect v4 is beta and moves.** The peer range is `>=4.0.0-beta.90` rather than an
  exact pin, which is what the fork learned when exact-beta pins caused resolution
  conflicts for consumers. Breaking beta renames land on us, not on the consumer.
- **Two lint gates instead of three.** The CosmOS Effect-4 idiom rules live in private,
  unpublished oxlint plugins that a standalone repo cannot resolve, so the syntactic
  half of the purity gate is missing here. See the open questions.
- **`--coverage` is the seam where "Bun only" is not literally true.** It is scoped,
  named, and gated; it is not a precedent.

## Enforcement

- **`test/stack.test.ts`** — a zero-dependency `bun test` (`bun:test` + `node:fs` only,
  importing no project code) that fails on:
  1. **A rival lockfile** — `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
  2. **A rival toolchain file** — `pnpm-workspace.yaml`, `turbo.json`, `vite.config.*`,
     or `vitest.config.*` at any level.
  3. **A banned dependency** in `package.json` — `react`, `react-dom`, `solid-js`, `vue`,
     `svelte`, `vite`, `vitest`, `turbo`, `storybook`, or any `@storybook/*`.
  4. **A foreign source file** under `src/` — any `.jsx`, `.tsx`, `.vue`, `.svelte`, or
     any `.js`/`.mjs`/`.cjs` file other than the single allowlisted
     `src/coverage/collector.mjs`.
  5. **A CSF-3 catalog** — any `*.stories.*` file, or a `*.showcase.ts` file whose
     catalog is a default export instead of `export const showcases`.
  6. **A `.env` file** anywhere, at any level.
  The allowlist in that test is one line; extending the fence is a deliberate edit to it.
- **`.oxlintrc.json` › `eslint/no-restricted-imports`** — the syntactic half: importing
  `react`, `react-dom`, `solid-js`, `vue`, `svelte`, `vite`, or `vitest` is an error at
  G1 speed, before the test suite runs.
- **`mise run typecheck`** — the patched `tsc` loads `@effect/language-service`, so
  Effect-4 semantic diagnostics (missing error channels, floating Effects, `Schema` over
  `JSON.parse`) ride along with the type check.
- **`.github/workflows/ci.yml`** — runs `lint`, `typecheck` and `test` on every push and
  pull request, then builds `dist/` and smoke-runs the built CLI under **both** runtimes
  (`mise run smoke`), under the Bun and Node versions `mise.toml` pins. There is no second
  CI path that could pass with a different toolchain.
- **Judgment, not gated (by design):** "prefer Effect for non-trivial logic" and "one
  vertical slice at a time" are review and convention. A gate can prove React is absent;
  it cannot prove the code is idiomatic.

## Open questions

1. **The vendored oxlint plugin gap.** CosmOS enforces 59 Effect-4 idiom rules through
   two oxlint `jsPlugins` — a fork of `@mpsuesser/oxlint-plugin-effect` and an in-house
   ADR plugin. Both are `"private": true` packages resolved over a `file:` path inside
   that repo, so this repository cannot use them. Three routes exist and none is chosen
   yet: depend on the public upstream plugin and lose the fork's fixes; publish the fork
   under a public scope; or vendor a built `dist/` here and carry a freshness guard. Until
   one is picked, `avoid-process-env`, `use-console-service`, `prefer-effect-fn`,
   `avoid-untagged-errors` and the rest are unenforced here, and only
   `@effect/language-service` covers the semantic half.
2. **Node-compatible distribution.** Should Foldcase publish a transpiled, Node-runnable
   build (`dist/*.js` plus a Node shebang) next to the Bun-native source, so the Foldkit
   community can install it with npm or pnpm? That would need a bundler this ADR
   currently bans, a second entry in `exports`, and a decision about whether `bun:test`
   usage in the runtime path (there is none today) stays absent. Unresolved; it is the
   trade-off named above and the most likely reason to amend this ADR.
3. **The browser lab.** If a lab shell is built as a Foldkit app in this repo, it needs a
   dev server. Foldkit's own tooling is Vite-based, which collides with the toolchain
   fence above. Whether the lab lives here, in a sibling package, or is dropped is
   undecided.

## Amendment 1 — 2026-07-31: a runtime-agnostic core, thin per-runtime shells

Open question 2 above — *"Should Foldcase publish a transpiled, Node-runnable build next
to the Bun-native source?"* — is now answered **yes**, and it is the amendment this ADR
predicted would come first. The record below stands as written; this section says what
changed and why. The decision has three parts.

### 1. The runtime fence moves

The original fence was **"Bun only"**. It is now **a runtime-agnostic core plus thin
per-runtime shells**:

- **The core is runtime-agnostic Effect.** `src/runner.ts`, `src/cli.ts`, `src/program.ts`,
  `src/docs/*`, `src/mcp/*` and `src/coverage/*` name no runtime. The platform services
  they need — `FileSystem`, `Path`, `ChildProcessSpawner`, `Stdio` — arrive from the Effect
  context, and `src/program.ts` *returns* the exit code rather than writing to `process`.
- **A shell binds exactly one runtime.** `src/main.ts` is the Node shell
  (`@effect/platform-node`, `NodeRuntime`, `NodeServices.layer`); `src/main.bun.ts` is the
  Bun shell (`@effect/platform-bun`, `BunRuntime`, `BunServices.layer`). Each is about
  fifteen lines: bind a runtime, hand the program `process.argv`, write back the exit code.
  Logic that appears in a shell is a bug.
- **The one thing a shell may know is its own runtime's quirks.** Node strips TypeScript
  types but does not rewrite relative specifiers, so a showcase importing `./Button` or
  `./Button.js` does not resolve there; the Node shell installs a `registerHooks` resolver
  for it. Bun resolves both itself and its shell installs nothing. The *policy* (which
  candidates to try) lives in `src/shell/nodeResolution.ts` and is unit-tested; only the
  `node:module` call sits in the shell.

This also settles the third contradiction the port found: `@effect/platform-bun` was
declared an **optional** peer while `src/main.ts` and `src/mcp/server.ts` imported it
unconditionally, so the `bin` hard-required an optional dependency. Now the MCP server
Layer takes `FileSystem | Path | Stdio` from the context like everything else, both
platform packages are optional peers, and each is optional *truthfully*: a consumer needs
only the one their shell runs, and the library entry points (`foldcase`, `foldcase/cli`,
`foldcase/mcp`) need neither.

### 2. The published artifact is a `tsc`-built `dist/`, not `.ts` source

`exports` and `bin` used to point at `src/*.ts`, which only Bun can consume. They now point
at `dist/*.js` with a `.d.ts` beside each, in the same `{ "types", "import" }` shape the
Foldkit package itself publishes — which is what makes it installable from npm and usable
from Node and Vite as well as Bun. `files` ships `dist`, `engines` names Node, and the
version restarts at **`0.1.0`**: nothing was ever published under the `core` line, so the
clean number wins.

**The build is plain `tsc -b tsconfig.build.json`. No bundler.** This is the part of the
original fence that *tightens* rather than relaxes:

- **`tsc` is a compiler, not a bundler.** It emits one `.js` + one `.d.ts` per source file
  and rewrites nothing else, so the published tree is the source tree and a consumer's own
  bundler (Vite, or none) sees ordinary ESM.
- **`bun build --compile` is dropped as a release artifact**, and not only on principle. A
  compiled Bun binary resolves `import(path)` inside its embedded `/$bunfs`, so
  `./foldcase test <dir>` could never load an external `*.showcase.ts` file: the artifact
  was broken by construction for the tool's primary command. Loading arbitrary
  user TypeScript at runtime is what Foldcase *is*, so a single-file binary is the wrong
  shape for it.
- **No bundler is a dependency, and none is invoked.** Vite, Vitest, turbo and the rest
  stay banned exactly as before; `tsc` joins Bun in the toolchain rather than replacing the
  ban.

`src/coverage/collector.mjs` is copied into `dist/` by the build, because `tsc` moves
TypeScript and this file is deliberately not TypeScript. It remains the one declared
non-TypeScript source (see *The one declared exception*).

### 3. What does not change

- **No React, Solid, Vue or Svelte** — in source, in tests, or in `devDependencies`.
- **No CSF-3.** A catalog is still `export const showcases` in a `*.showcase.ts` file.
- **No Vite and no Vitest as *our* dependencies.** Foldcase is now *consumable* from a Vite
  project; it does not become a Vite project.
- **Effect stays a peer dependency**, so a consumer and Foldcase share one Effect instance.
- **Bun stays the development toolchain**: `bun test` is the suite, `bun install` the
  package manager, `mise` the version pin.
- **TDD stays mandatory**, one vertical slice at a time.

### Consequences

- **The audience cost named in *Consequences* above is paid off.** A Foldkit user on Node +
  npm/pnpm + Vite can install and run Foldcase. That was the accepted cost of the original
  decision and the stated trigger for revisiting it.
- **Two shells is two code paths to keep honest**, so the fence is gated rather than
  reviewed (below). The shells are small enough that "keep them thin" is checkable by eye,
  and the gate checks the part that is not.
- **`foldcase test` under Node needs a Node that strips types** — Node 22.18 or newer,
  which `engines` states. Under Bun any supported Bun works. Nothing else in the package
  needs more than Node 18.
- **`--coverage` still spawns Node**, and now for a second reason: it is the only runtime
  with programmatic V8 precise coverage. Under the Node shell the spawn is the same runtime
  the CLI is already running on, which makes the exception less strange, not more.

### Enforcement (added by this amendment)

`test/stack.test.ts` gains three clauses, each proven to fire on a planted violation:

7. **The runtime fence** — only the two declared shells import an `@effect/platform-*`
   package; each imports exactly the one it is named for; and every package a shell binds
   is declared in `peerDependencies` *and* marked optional in `peerDependenciesMeta`.
8. **No bundler** — no bundler is declared as a dependency, and no build task invokes one.
   `mise.toml`'s `build` task must run `tsc -b`.
9. **The published shape** — every `exports` subpath is a `{ "types", "import" }` pair
   pointing into `dist/`, `bin` points into `dist/`, `files` ships `dist` and not `src`,
   and `engines` names Node.

Two shells and a compiled `dist/` are things a `bun test` run cannot see, so CI grew a
second job: `mise run build` followed by **`mise run smoke`**, which drives `dist/main.js`
under Node and `dist/main.bun.js` under Bun through the usage banner, `test`, `--coverage`
and `docs`. It proves both bins exist and are executable, that each runtime resolves a
consumer's extensionless TypeScript import, that the coverage collector is really copied
into `dist/coverage/` and spawns, and that the exit codes are what the README promises.
`mise.toml` also pins **Node 22.18.0** — the floor `engines` claims and the first release
with unflagged type stripping — so nothing is tested against whatever Node a machine
happened to have.

`test/surface-derivation.test.ts` › *Exports drift* keeps its job across the change: an
entry point is now checked against **the source it is built from**, and additionally
against the build output whenever `dist/` is present. A gate that only passed after a build
would be a trap — green on a developer's machine, red on a clean checkout — so it is the
mapping from `dist/x.js` back to `src/x.ts` that is always enforced, and the built file on
top of it when there is one.

## Amendment 2 — 2026-08-04: the repository stands on its own, and `core` is `main`

The record above describes a fork: a `core` branch for this line, `main` tracking the
Openstory upstream, and a GitHub repository marked *forked from millionco/openstory*. That
arrangement cost more than it explained. A fork cannot open Issues, so `bugs.url` pointed
at a page nobody could post to; the front page showed the upstream README to anyone who
arrived; and the branch named `main` held a codebase this line does not build, test or
publish.

So the repository is now `tao-io/foldcase`, created fresh rather than forked, and this line
is on `main`. The fork line — every branch of it, including the six feature branches that
were open — is pushed alongside as history, and `main` does not descend from it.

**The attribution does not change.** Openstory is where the `play` contract and the
`SerializedError` shape come from, `LICENSE` keeps its copyright notice, `NOTICE` records
what is derived and from whom, and the README says so in prose. Detaching the git
relationship removes a claim about *branch ancestry*, not a claim about credit.
