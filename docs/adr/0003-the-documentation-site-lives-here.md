---
type: adr
title: The documentation site lives in this repository, and Vite is a declared exception for it
description: A foldocs site is a Foldkit application built by Vite, which ADR-0002 fenced out. It is admitted anyway, under docs/site/, because the prose it publishes is this repository's own and a second repository would fork it — the drift ADR-0001 exists to prevent. The hole is one directory, one Vite config, one manifest and two mise tasks, each pinned by name in the stack gate.
status: accepted
created: 2026-08-04
updated: 2026-08-04
---

# 0003 — The documentation site lives here; Vite is a declared exception for it

## Context

Foldcase's documentation is prose in this repository: `README.md`, `CHANGELOG.md`, and
the ADRs under `docs/adr/`. Read on GitHub it is a wall of Markdown with no search, no
navigation, and no `llms.txt`. A documentation *site* was wanted.

[foldocs](https://github.com/tarkaworks/foldocs) is the Foldkit-native answer: a
documentation framework that is itself a Foldkit application, on Effect, MIT-licensed. It
fits this line's framework choice exactly. It is also built by **Vite** — its scaffolded
build is `tsc --noEmit && vite build` — and Vite is the one tool
[ADR-0002](0002-bun-effect-foldkit-only.md) explicitly left on the `foldkit` branch.

So the site could not simply be added. Three ways out were considered, and the question
turns on where the prose lives, not on where the build tool is comfortable.

## Considered options

**A second repository (`tao-io/foldcase-docs`).** Clean toolchain separation: npm, Vite
and foldocs with nothing to declare. Rejected on the thing this project is *about*. The
site's content is this repository's `README.md`, `CHANGELOG.md` and `docs/adr/*`. A second
repository either copies that prose — a second definition of the same fact, which is the
drift [ADR-0001](0001-showcase-one-definition-many-surfaces.md) exists to forbid — or
derives it across a repository boundary through a submodule, a subtree, or a CI fetch.
Derivation across a boundary works, and it was built and proved to work, but every form of
it has a **pin**: the site publishes the repository as of some commit, and between a
change here and a bumped pin there the two disagree. A tool whose first principle is *one
definition, many surfaces* should not publish its own documentation through a mechanism
with a drift window in it.

**A git worktree of this repository.** Considered and rejected as a non-answer: a worktree
is a second checkout of the *same* repository, backed by the same object database and the
same remote. Anything committed in one is a branch of `tao-io/foldcase`, so the site's
files enter this repository's history regardless, `test/stack.test.ts` fails wherever that
branch is checked out, and ADR-0002 is contradicted just as directly — with the added cost
that the contradiction is hidden in a second working directory instead of being written
down. A worktree changes where files sit on disk; it changes nothing about what the
repository contains. (An orphan branch dodges none of it.)

**In this repository, with the exception declared.** Accepted, below.

## Decision

**The documentation site lives in `docs/site/`, and Vite is admitted for it alone, as a
declared exception in the shape ADR-0002 already uses for the coverage collector.**

The site derives every page from the working tree it sits in:
`docs/site/scripts/sync-content.mjs` reads `README.md`, `CHANGELOG.md` and `docs/adr/*.md`
and writes `docs/site/content/`, which is **gitignored**. There is no pin, no submodule,
and no window in which the site and the repository disagree — they are the same files. A
document that is not derived cannot be committed, because the directory it would live in
is not tracked.

The hole is exactly this wide, and every item is pinned by an assertion in
`test/stack.test.ts` › *ADR-0003 — the documentation site*, so widening it is a deliberate
edit to that file rather than a quiet extra line:

| Allowance | Value |
|---|---|
| One directory | `docs/site` |
| One Vite config | `docs/site/vite.config.ts` |
| One manifest that may declare `vite` | `docs/site/package.json`, and `vite` only |
| Two tasks that may invoke a bundler | `docs:build`, `docs:dev` |

Everything else in the fence still applies to the site, and the gate got **stricter** in
the same change that opened the hole:

- **No rival lockfile.** The site installs with Bun into its own `node_modules`, the way
  `examples/counter` already does, so `docs/site/bun.lock` is the only lockfile it adds.
- **Every manifest is now read, not just the root one.** Before this ADR the banned-package
  and bundler checks looked at `package.json` alone; a nested manifest could have declared
  React and gone unseen. They now walk every manifest in the repository, and only the site's
  is granted `vite`.
- **`docs:deploy` gets no bundler allowance,** because it hands the build to alchemy and
  names no bundler itself.
- **Nothing of the site ships.** `files` does not include `docs`, and `mise run pack`
  already asserts the tarball withholds `docs/` from the other side.

## Consequences

- **The tool's own stack is untouched.** Vite never runs over `src/`, never produces
  `dist/`, and never enters the published tarball. `mise run build` is still `tsc -b`;
  `bun test`, `oxlint src test` and `tsc --noEmit` still see no site at all — the root
  `tsconfig.json` includes only `src` and `test`, and the lint task only those two.
- **The site's dependency tree is its own.** It pins TypeScript 6.0.3 to match this
  repository rather than the TypeScript 7 its template asked for, because `@typescript/vfs`
  under twoslash cannot read TS 7's internals.
- **The repository now has two `bun install` roots**, three counting `examples/counter`.
  `mise run docs:build` installs the site's on first use, so no one has to know that.
- **The site is not in CI's five checks.** `lint`, `typecheck`, `test`, `build` and `smoke`
  do not build it; a broken site cannot redden a release. That is deliberate for now, and
  it is the first thing to revisit if the site starts carrying anything load-bearing.
- **Deployment is Cloudflare through alchemy** (`docs/site/alchemy.run.ts`,
  `mise run docs:deploy`), which is how foldocs deploys its own documentation. The Worker
  answers on a `workers.dev` subdomain, so no domain is required; credentials come from
  `alchemy login` or `CLOUDFLARE_API_TOKEN` in CI, and never from a file in this
  repository.
- **The reader gets one URL and the agent gets `llms.txt`,** generated from the same prose
  a maintainer edits in `README.md`. That is the payoff, and it is the same payoff
  ADR-0001 claims for Showcases: write the fact once, project it many ways.
