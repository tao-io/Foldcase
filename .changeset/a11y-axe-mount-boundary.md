---
"foldcase": minor
---

a11y at the mount boundary: run axe-core against the rendered DOM

After a Showcase mounts, boot optionally runs `axe.run(container)` on the produced
DOM and posts a new append-only `StoryToShell` `a11y` variant (rule id, impact, help,
helpUrl, target selectors — a small JSON-safe payload). Because it audits the DOM the
renderer produced, it is renderer-agnostic (React/Foldkit/Solid/Vue/Svelte for free).

The run is gated behind an `a11y=1` URL flag and loads axe-core via dynamic import, so
plain preview / headless boots stay lean (axe-core is browser-bundle weight). The shell
requests the audit for every Showcase, collects the violations, and renders them in a new
a11y panel plus a Canvas badge showing the violation count.
