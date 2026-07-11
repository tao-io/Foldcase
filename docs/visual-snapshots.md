# Per-Showcase visual snapshot gate (three-state)

The visual gate is Foldcase's safety net for agent-generated UI: it catches the failure mode
where the code compiles and functional/`play` tests pass but the **pixels are wrong**. It is
deliberately **three-state** — pass / unresolved / fail — so an ambiguous diff is surfaced as
"changed, needs a decision" instead of being forced into a binary pass/fail (roadmap §1, the
Chromatic/Applitools rows).

## How it renders

Each covered Showcase is rendered in a real headless Chromium via Playwright, driving the same
integration path as the render tests: the dev server + `openstory()` plugin serve the Showcase
at `/__story/<id>`, and the gate screenshots the iframe's `#openstory-root` canvas. This needs
**no standalone shell build** — it screenshots exactly what the integration project can render.
If a Showcase has a `play`, capture waits for it to settle so the baseline captures the
post-interaction state deterministically.

## The three states

| Verdict        | When                                                                        | Exit code |
| -------------- | --------------------------------------------------------------------------- | --------- |
| **pass**       | mismatch ratio ≤ `passRatio` (default 0.001 = 0.1% of pixels)               | `0`       |
| **unresolved** | `passRatio` < ratio ≤ `unresolvedRatio` (default 0.05 = 5%)                 | `2`       |
| **fail**       | ratio > `unresolvedRatio`, no baseline, dimension mismatch, or render error | `1`       |

`unresolved` is never auto-passed or auto-failed. The runner prints it distinctly and exits `2`,
so CI can treat it as a "needs a decision" signal (e.g. request review) rather than a red build.

## Running it

```bash
# Check against committed baselines (CI). Exit 0 / 2 / 1 = pass / unresolved / fail.
pnpm --filter foldcase visual

# Accept the current renders as the new baselines (the standard --update / -u flow).
pnpm --filter foldcase visual:update

# Same, via the integration test:
UPDATE_SNAPSHOTS=1 pnpm --filter foldcase test:integration
```

Baselines are committed PNGs under `packages/openstory/tests/integration/__screenshots__/`.
Transient diff images (written only on a non-pass) go to a git-ignored `__diffs__/` beside them.

## Coverage in this slice

A working vertical slice over two real Showcases — `foldkit-counter--basic` and
`a11y-image--clean` — with committed baselines and a determinism check. Cross-platform baseline
portability (fonts/AA differ between OSes) is the reason for the tolerance band; committing
baselines per-CI-image is the intended operational model. Full-catalog coverage and pointing the
runner at arbitrary consumer projects are deferred.

## The LLM-judge seam (optional, follow-up)

Resolving an `unresolved` diff into pass/fail can be delegated to an AI reviewer. The seam is
the `VisualJudge` interface (`packages/openstory/src/visual/judge.ts`):

```ts
export interface VisualJudge {
  resolve: (request: VisualJudgeRequest) => Promise<VisualVerdict>; // "pass" | "fail" | abstain "unresolved"
}
```

`applyJudge(comparisons, judge)` routes only the `unresolved` comparisons through the judge; a
judge that returns `"unresolved"` abstains and leaves the diff for a human. **No judge is wired
by default** — the gate stays deterministic and pulls in no external keys/infra, so there are no
half-built integrations. Wiring a concrete vision-model judge (and passing the baseline/actual/
diff image buffers, which `VisualJudgeRequest` already carries) is the CosmOS-tool side
(`tools/foldcase`, roadmap §5) and is tracked separately.
