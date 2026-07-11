# tao-io/openstory — a Foldkit-native fork of Openstory

This is `tao-io`'s fork of [millionco/openstory](https://github.com/millionco/openstory)
(MIT), maintained to make Openstory a first-class **Foldkit** component explorer.

**Why a fork.** Openstory is framework-agnostic; the value we want is Foldkit-specific
(a live TEA `Model` inspector + MCP time-travel per component). Rather than carry an
unmerged PR + patches as a vendored tarball forever, we own the base and develop it
freely. MIT permits this; attribution is preserved in `LICENSE` + `NOTICE`.

## Provenance
- `main` tracks upstream `millionco/openstory` (remote `upstream`) for sync.
- `foldkit` (this line) = `main` + the Foldkit adapter from
  [binarytide's PR #4](https://github.com/millionco/openstory/pull/4)
  (remote `binarytide`, branch `codex/foldkit-adapter`) + the changes below.

## What changed here
- **0.127 Runtime API:** `packages/openstory/src/foldkit/renderer.ts` now calls
  `Runtime.makeApplication(...).start()` (0.104's `makeProgram` was removed in 0.127).
- **Version pins** modernized toward the current Foldkit line (dev: foldkit `^0.127.0`,
  effect `4.0.0-beta.88`; peers widened to `>=4.0.0-beta.66` so 0.127 consumers install
  without the exact-beta ERESOLVE skew).

## Roadmap (Foldkit-native dev instruments)
- Per-component **DevTools overlay** (Foldkit `@foldkit/devtools` `overlay`) mounted in
  the story canvas — a story-set `devTools` already flows through the adapter's
  `makeApplication({ ...config })`, so this is largely a story/preview affordance.
- **DevTools → MCP relay** in the dev server (Foldkit vite-plugin `devToolsMcpPort`) so
  an agent can `dispatch_message` / `get_model` / `replay_to_keyframe` against a story.
- Component-explorer vocabulary aligned to the Foldkit test pyramid: **Story · Showcase · Scene**.
- (Bigger) evaluate rebuilding the Openstory shell UI itself as a Foldkit app.

## Pending / not yet done
- The adapter's integration fixture + `foldkit-render.test.ts` still pin the old
  beta.66/0.104 stack; re-point them at 0.127/beta.88 and re-verify (task #1).
- Consider contributing the 0.127 renderer fix back to `binarytide`'s PR / upstream.
- Rebrand (name/package) once the direction is settled — currently keeps the Openstory name.

## Downstream consumer
Bina's Teacher-Desk **Showcase** lab (`bina` repo, scope-039) currently consumes a
vendored build of this adapter; it will repoint at a published build of this fork.
