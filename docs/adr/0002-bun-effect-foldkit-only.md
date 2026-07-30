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
- **`.github/workflows/ci.yml`** — runs `lint`, `typecheck`, and `test` on every push and
  pull request, under the Bun version `mise.toml` pins. There is no second CI path that
  could pass with a different toolchain.
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
