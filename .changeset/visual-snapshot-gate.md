---
"foldcase": minor
---

Per-Showcase visual snapshot gate with a three-state ("unresolved") outcome

A visual regression safety net for agent-generated UI: each covered Showcase is rendered in
a headless Chromium (reusing the existing dev-server + plugin integration path — the iframe
`#openstory-root` canvas, so no dependency on the standalone shell build), screenshotted, and
compared against a **committed baseline** under `tests/integration/__screenshots__/`.

The verdict is **three-state**, not binary — the Applitools-style "changed, needs a decision":

- **pass** — the render matches its baseline within tolerance (`passRatio`, default 0.1% of
  pixels).
- **unresolved** — the diff is in the ambiguous band (`passRatio < ratio ≤ unresolvedRatio`,
  default ≤ 5%). Surfaced distinctly and **never auto-passed or auto-failed**.
- **fail** — a hard mismatch beyond `unresolvedRatio`, a missing baseline, a dimension
  mismatch, or a render error.

The gate ships as small, pure, unit-tested modules under `packages/openstory/src/visual/`
(`classify`, `compare` via `pixelmatch`/`pngjs`, `baseline` management, `report`, `judge`,
`gate`, `capture`) plus a standalone runner `scripts/visual-gate.ts` that surfaces the three
states as **distinct process exit codes** — `0` pass · `2` unresolved · `1` fail:

```bash
pnpm --filter foldcase visual          # check (CI)
pnpm --filter foldcase visual:update   # accept current renders as new baselines
```

Baseline management uses the standard update flow: `UPDATE_SNAPSHOTS=1 pnpm test:integration`
(or `visual:update`) (re)writes the baselines; check runs compare against them. Transient diff
PNGs land in a git-ignored `__screenshots__/__diffs__/`.

Coverage: a genuinely-working vertical slice over **two real Showcases** (`foldkit-counter--basic`
and `a11y-image--clean`) with committed baselines, plus a determinism check. Full-catalog and
consumer-project coverage are deferred (the runner currently targets the integration fixture).

**LLM-judge seam (optional, follow-up):** the `VisualJudge` interface (`src/visual/judge.ts`,
`applyJudge`) is the documented hook where an AI reviewer can resolve an "unresolved" diff into
pass/fail. It is intentionally **not wired** — no external keys/infra are pulled in — so there
are no half-built integrations or dead paths. Wiring a concrete vision-model judge (and pointing
the runner at arbitrary consumer projects) is the CosmOS-tool side (`tools/foldcase`, roadmap §5),
tracked separately.
