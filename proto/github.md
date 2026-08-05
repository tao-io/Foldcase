repo: tao-io/foldcase
branch: main

## Last sync

date: 2026-08-04T21:28:38Z

### Updated in this project

- Read the README, reports/runner contracts and the `examples/counter` catalog as the source of truth for Showcase data.
- Copied the brand marks from `docs/brand/` (mark, inverse, lockups, favicon) — used as a mask so one file serves both themes.
- Canvas timeline rebuilt on Foldkit's devtools overlay vocabulary (foldkit/foldkit `packages/devtools`): message list with padded indices, diff dots, `+Nms` deltas, Live / Resume → / Clear history, and the footer scrubber (4px track, 14px accent thumb, `003 / 012` position).
- Built `Foldcase Lab.dc.html`: a component-explorer UI (`foldcase lab`) over the catalog. Foldcase has no GUI upstream, so this is net-new design, not a recreation.

## Screen map

| Screen | Built from |
| --- | --- |
| Foldcase Lab — sidebar tree (file → component → state) | examples/counter/src/counter.showcase.ts, examples/counter/src/tasks.showcase.ts |
| Report / Timeline / Source / View canvas | examples/counter/src/counter.ts, examples/counter/src/tasks.ts, src/runner.ts contracts via src/reports.ts, README.md (`--json`, failure output) |
| Failed-file state | README.md ("A type-only import must say import type"), src/cli.ts load-failure reporting |
| Docs tab (Message / Model tables) | examples/counter/docs/counter.md, examples/counter/docs/tasks.md |
| Coverage / Gaps / Agent (MCP) / JSON panels | README.md (`--coverage`, gaps, six MCP tools), src/reports.ts |
| Canvas tab — preview + devtools timeline | foldkit/foldkit@main packages/devtools/src/overlay.ts, packages/devtools/src/overlay-styles.ts, packages/website/src/page/core/devtools.md, examples/counter/src/counter.ts (update + view) |
| Brand, theme colours | docs/brand/README.md, docs/brand/mark.svg, docs/site/index.html (theme-color #f8f7fb / #1e1c21) |
