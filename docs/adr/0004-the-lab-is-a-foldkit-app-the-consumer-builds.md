---
type: adr
title: The lab is a Foldkit application the consumer builds; no bundler runs here for it
description: The browser lab is an ordinary TypeScript surface. tsc -b compiles src/lab/ to dist/lab/ like every other module and it publishes as the foldcase/lab entry point; the consumer's own dev server imports it and bundles it with their Foldkit and their Effect. A Foldkit application already needs @foldkit/vite-plugin for import.meta.hot and the view-identity transform, so the bundler this line will not run is one the lab's audience must run anyway. foldkit becomes an optional peer dependency, the first time this line declares Foldkit at all.
status: accepted
created: 2026-08-04
updated: 2026-08-04
---

# 0004 — The lab is a Foldkit app the consumer builds

## Context

[ADR-0001](0001-showcase-one-definition-many-surfaces.md) reserved a row in its table of
surfaces for a **browser lab shell**, marked *not built yet*, and bound it in advance: when
it lands it renders from the declaration, not from a DOM crawl or a source parse.
[ADR-0002](0002-bun-effect-foldkit-only.md) left the harder half open as its third open
question — a lab shell built as a Foldkit app in this repository needs a dev server,
Foldkit's own tooling is Vite-based, and that collides with the toolchain fence. Whether
the lab lived here, in a sibling package, or nowhere was undecided.

The lab is now built, and the open question rested on a false premise. It assumed the lab
needs *a* dev server and that the only candidate was ours. It does need one. It is not
ours.

A Foldkit application cannot run on a bare bundler. `@foldkit/vite-plugin` does two things
that are not cosmetic:

- **`import.meta.hot`.** Foldkit's devtools open a WebSocket over Vite's HMR channel. No
  plugin, no `import.meta.hot`, no bridge — and `@foldkit/devtools-mcp` then has nothing to
  attach to.
- **The view-identity transform.** The plugin brands every view result, so the differ
  *replaces* a subtree when a conditional view arm changes instead of patching the old one
  in place. A component gallery swaps components in and out of one slot, which is exactly
  the case that mispatches without the brand.

So anyone who can use the lab is already running Vite with that plugin, because that is
what running Foldkit means. The bundler this repository will not run is one the lab's
audience runs anyway.

## Considered options

**Serving ES modules directly, with no bundler at all.** Technically possible, and checked
rather than assumed: `foldkit`'s published tree is pure ESM with extensioned relative
imports and only four bare specifiers to map, so an import map over a static file server
resolves it. Rejected on what it costs. Without `import.meta.hot` there is no devtools
bridge, so `@foldkit/devtools-mcp` cannot reach the lab — and the agent half of the lab is
the half that matters. Without the plugin's brand the differ mispatches the swapped views
the lab exists to swap.

**A second declared exception, in the shape of ADR-0003.** Rejected because nothing needs
it. [ADR-0003](0003-the-documentation-site-lives-here.md) opened a hole because the
documentation site had no other home: the prose it publishes is this repository's own, and
every second home takes a pin that can lag. The lab has another home, and it is already
running — the consumer's dev server. An exception with an alternative is not an exception,
it is a preference.

**The lab emits an entry module the consumer's own dev server builds.** Accepted, below.

## Decision

**`src/lab/` is an ordinary TypeScript surface: `tsc -b` compiles it to `dist/lab/` like
every other module, it publishes as the `foldcase/lab` entry point, and the consumer's dev
server bundles it with their Foldkit and their Effect. No bundler runs in this repository
for the lab.**

The lab ships source-shaped, one `.js` and one `.d.ts` per file, the same as the rest of
`dist/`. The consumer writes a small entry module — or has `foldcase lab` scaffold it —
that imports `foldcase/lab` and their catalog, and the Vite config they already keep builds
it.

Four things were measured before this was written down, not argued:

- **A plain `tsc` build resolves and bundles under a consumer's Vite.** The library was
  compiled by `tsc` under `module: NodeNext`, emitting one `.js` and one `.d.ts` per source
  file, and a consumer's Vite project imported it, built it and ran it with no
  configuration for it.
- **One Foldkit instance ran, not two.** Vite resolved the library's own `foldkit` import to
  the consumer's optimised dependency — the resolution ADR-0002 already relies on for
  Effect, measured here for Foldkit.
- **The seam renders.** The lab shell came up and an embedded component mounted inside it.
- **The agent surface arrives free.** `@foldkit/devtools-mcp` listed the lab runtime and
  each live embedded runtime separately, so time travel and agent access over a showcased
  component cost no new MCP tool.

## Consequences

- **`foldkit` becomes an optional peer dependency**, in the shape ADR-0002 already uses for
  `@effect/platform-node` and `@effect/platform-bun`: named in `peerDependencies`, marked
  optional in `peerDependenciesMeta`, and needed by exactly one entry point. The runner, the
  CLI, the MCP server and the docs generator need none of it; only `foldcase/lab` does. This
  is the first time this line declares Foldkit at all — ADR-0002 says Foldcase depends on
  none of it, because `play` is opaque — and declaring it now is the honest move rather than
  a retreat. The lab *is* a Foldkit application. `play` is a thunk and could stay silent
  about what produced it; the lab renders Foldkit views, so it says so.
- **The fence in ADR-0002 is unchanged and ADR-0003's hole is no wider.** The lab adds no
  `vite.config.*`, no manifest that names a bundler, and no mise task that invokes one.
  `mise run build` is still `tsc -b`, and the stack gate's allowance is still one directory,
  one config, one manifest and two tasks, every one of them `docs/site`.
- **The lab is a library, not a server.** The `foldcase lab` verb scaffolds the entry module
  and stops. It does not bundle, it does not serve, and it starts no watcher. Serving is the
  consumer's dev server's job, and that server is already up.
- **Nothing of the lab reaches a consumer who does not import it.** It is one more entry
  point in `exports`; an entry point nobody imports is never resolved, so a Node user of
  `foldcase test` never has `foldkit` asked of them.
- **The lab runs only where Foldkit runs.** A consumer without `@foldkit/vite-plugin` gets a
  lab that draws and a devtools bridge that never opens. That is the price of not owning the
  dev server, and it is small: the plugin is not optional for a Foldkit app either way.
- **ADR-0002's third open question is closed.** The lab lives here, as source. The dev
  server does not live here at all.
