---
type: adr
title: The dogfood is a vendored consumer, and the stack gate declares it out of scope
description: examples/counter is eight Showcases we wrote, so it can only find what we already thought to look for. The Foldkit component gallery — 24 components, 146 Showcases, an application we did not write — found five defects in this tool. It is vendored as a git submodule under dogfood/, pinned to a commit, and the gate declares that directory out of scope in the shape ADR-0003 uses: one directory, one submodule, nothing read there, one task that may drive it, each pinned by name in test/stack.test.ts.
status: accepted
created: 2026-08-04
updated: 2026-08-04
---

# 0005 — The dogfood is a vendored consumer, declared out of the gate's scope

## Context

`mise run dogfood` drives the built CLI over `examples/counter`: eight Showcases, two
generated documents, both runtimes. It is useful and it is small, and its limit is that we
wrote it. A fixture written by the tool's author exercises the paths the author already
had in mind. It cannot report what a real application does with the tool, because it is
not one.

The Foldkit component gallery is. It has 24 `@foldkit/ui` components, one page each, 146
Foldcase Showcases under `src/ui/`, and one shared `UiModel`, `UiMessage` and `uiUpdate`
behind all of them. Running Foldcase over it found five defects in this tool that no
fixture here had found.

Keeping that reach means the dogfood has to stay a real consumer as it grows — a codebase
that changes for its own reasons and then tells us what broke. A copy stops being one the
day it is taken.

The gallery also carries `vite`, `vitest` and `@tailwindcss/vite` in its manifest, a
`vite.config.ts` and a `vitest.config.ts`. Every one of those trips a rule in
`test/stack.test.ts` today. That is the point rather than the problem: the fence describes
what *this repository* is, and a consumer's toolchain is not ours to hold an opinion about.

## Considered options

**Copy the gallery's source into `examples/`.** Rejected on two counts. It rots the moment
upstream moves, and a stale copy answers a question about last month's application. And
the shape resists the copy: all 24 components share one `uiUpdate`, a single 1295-line
function, so lifting one component out means splitting that function by hand — which
invents a second description of what the gallery is, the drift
[ADR-0001](0001-showcase-one-definition-many-surfaces.md) exists to forbid.

**Point a task at the gallery on the developer's machine.** Rejected as not reproducible.
A path in a task body is true on one laptop and false everywhere else, CI included, so the
check would pass for the person who wrote it and fail or silently skip for everyone else.
A check nobody else can run is not a check.

**Vendor it as a submodule at a pinned commit, declared out of the gate's scope.**
Accepted, below.

## Decision

**The gallery is a git submodule at `dogfood/gallery`, pinned to a commit, and the stack
gate declares `dogfood/` out of scope: we read it and run our own CLI against it, and we
do nothing else with it.**

Out of scope means what it says. Nothing under `dogfood/` is built, linted, typechecked,
tested by `bun test`, or shipped. Nothing there is edited, either: it is another
repository, and the only write this repository makes into it is the `node_modules` a `bun
install` leaves behind.

The scope is exactly this wide, and every item is pinned by an assertion in
`test/stack.test.ts` › *ADR-0005 — the vendored dogfood consumer*, so widening it is a
deliberate edit to that file:

| Allowance | Value |
|---|---|
| One directory | `dogfood`, and only at the repository root |
| One submodule | `dogfood/gallery` → `github.com/tao-io/foldkit-gallery` |
| What the gate reads there | nothing |
| One task that may drive it | `dogfood:gallery` |

Say plainly what this exception is **not**:

- **It does not let a bundler run here.** `dogfood:gallery` runs the built `dist/` over the
  gallery's `src/ui` and asks for nothing else, so it needs no place in
  `DECLARED_SITE_TASKS` and is deliberately given none — the same reason `docs:deploy` is
  absent from that list ([ADR-0003](0003-the-documentation-site-lives-here.md)). The gate
  still fails on any task of ours that calls one.
- **It puts no banned package in a manifest of ours.** The gallery's manifest is the
  gallery's. Every manifest this repository owns is still read in full, and
  `docs/site/package.json` is still the only one granted anything.
- **It does not widen ADR-0003's hole.** That exception is one directory, one config, one
  manifest and two tasks, all of them `docs/site`, and it is unchanged.

Updating the dogfood is deliberate. The pin is a commit, so the gallery moves here only
when someone bumps it and says why, and a run that used to pass and now fails names a
change either side of the boundary rather than an overnight surprise.

## Consequences

- **The dogfood can now find what we did not think of.** 146 Showcases over 24 components
  written by someone testing their own application, not the tool, is a different sample
  from eight fixtures written to exercise the runner. Five defects came out of the first
  pass. A fresh clone installs, and both bins report `146 total · 146 passed · 0 failed` in
  under a second.
- **The gate is smaller by one directory and no weaker anywhere else.** `dogfood` joins
  `coverage` and `foldcase-docs` in the set ignored at the root, so a `dogfood/` under
  `src/` or `test/` is still read like any other. The assertions in §12 prove the
  vendored consumer really is there and really does carry a banned package, a bundler and
  a rival config — so the scope cannot quietly become a hole around an empty directory.
- **A clone without submodules still works.** `git clone` alone leaves `dogfood/gallery`
  empty; the seven checks pass regardless, the gate's non-vacuity assertions skip rather
  than fail, and `dogfood:gallery` says how to fetch it. `--recurse-submodules` or `git
  submodule update --init dogfood/gallery` is the whole cost.
- **The task installs the gallery's runtime half only.** The gallery pins `foldcase` at an
  absolute path to a tarball on the machine it was authored on, which resolves nowhere
  else. Its Showcases import the type and nothing more, so `--omit=dev` steps around the
  pin and everything under `src/ui` still runs. Editing their manifest to fix it is the one
  move the decision above rules out.
- **`dogfood:gallery` is in none of the seven checks**, alongside the three `docs:*` tasks
  and for the same reason: a moved pin, or a gallery that fails for its own reasons, must
  not redden a release. It is run when the pin moves and when the tool changes under it.
- **We still do not serve the gallery.** [ADR-0004](0004-the-lab-is-a-foldkit-app-the-consumer-builds.md)
  says the lab is a Foldkit application the consumer builds, and the gallery is a consumer
  with its own dev server already running. `dogfood:gallery` writes a lab entry into a
  temp directory to prove the projection counts what the run produced, then throws it away.
  It bundles nothing and serves nothing.
