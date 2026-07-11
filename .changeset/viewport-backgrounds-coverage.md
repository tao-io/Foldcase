---
"foldcase": minor
---

Viewport + background toolbars and v8 coverage

The shell top bar gains two new toolbar selectors — a **viewport** picker and a
**background** picker — sitting alongside the existing globals toolbar. Choosing a viewport
resizes the canvas iframe (centered, scrollable) to the selected dimensions; choosing a
background recolors the canvas surface behind it. Both read a Showcase's declared
`parameters.viewport` (Storybook shape: `viewports[key].{ name, styles: { width, height } }`
+ `defaultViewport`) and `parameters.backgrounds` (`values: [{ name, value }]` + `default`,
with `disable` hiding the picker), merging per-Showcase parameters over preview-global ones.
When a Showcase declares none, built-in presets are offered (Mobile / Tablet / Desktop and
Light / Dark), plus an always-present "Responsive" / "Default" reset. Pure DOM/CSS — no
renderer or manifest changes.

Coverage: the `vp test` config now enables the **v8** coverage provider (`@vitest/coverage-v8`),
so `pnpm exec vp test --coverage` produces a per-file report over `packages/openstory/src`.

Tests: a unit spec for the pure preset resolver (built-in vs declared viewports/backgrounds,
defaults, and the backgrounds `disable` flag), and a minimal happy-dom React spec for the
Canvas asserting the iframe resizes to a chosen viewport and the surface recolors to a chosen
background (the shell has no React test harness, and its dev-served dist can't be rebuilt in
this environment, so an in-process component test — not a Chromium integration test — covers
the visible deliverable).

Follow-up (not in this change): **deep per-Showcase story-coverage** — instrumenting
`view`/`update` during a Showcase's `play` to attribute coverage to individual stories — is
the CosmOS-tool side (`tools/foldcase`, roadmap §5), tracked separately. This fork change is
only the coverage-provider config toggle.
