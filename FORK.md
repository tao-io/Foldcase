# foldcase — a Foldkit-native component explorer (fork of Openstory)

`foldcase` (github.com/tao-io/foldcase) is `tao-io`'s fork of
[millionco/openstory](https://github.com/millionco/openstory) (MIT), maintained to make
it a first-class **Foldkit** component explorer.

**The name.** `foldcase` = **fold** (Foldkit) + (show)**case** — the tool renders
**Showcases**. It extends Foldkit's testing family **Story · Scene** with the isolation
layer **Showcase** (Story · Showcase · Scene), the component performing outside the app.

**Why a fork.** Openstory is framework-agnostic; the value we want is Foldkit-specific
(a live TEA `Model` inspector + MCP time-travel per component). Rather than carry an
unmerged PR + patches as a vendored tarball forever, we own the base and develop it
freely. MIT permits this; attribution to millionco + binarytide is in `LICENSE` + `NOTICE`.

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

## Roadmap
1. **Rename the internals** `openstory` → `foldcase` (package name, `bin`, and the public
   `openstory/foldkit` export → `foldcase/foldkit`). This is a real refactor and changes the
   consumer import — Bina's Showcase lab imports `openstory/foldkit` today; migrate together.
2. **Green on 0.127:** re-point the adapter's integration fixture + `foldkit-render.test.ts`
   off beta.66/0.104, `pnpm build`, run tests.
3. **Foldkit-native dev instruments:** per-component **DevTools overlay** (Foldkit
   `@foldkit/devtools` `overlay` — a story-set `devTools` already flows through the adapter's
   `makeApplication({ ...config })`); **DevTools → MCP relay** in the dev server (foldkit
   vite-plugin `devToolsMcpPort`) for `dispatch_message` / `get_model` / `replay_to_keyframe`.
4. (Bigger) evaluate rebuilding the shell UI itself as a Foldkit app.
5. Consider contributing the 0.127 renderer fix back to binarytide's PR / upstream.

## Downstream consumer
Bina's Teacher-Desk **Showcase** lab (`bina` repo, scope-039,
`.../frontend/showcase/`) currently vendors a build of this adapter; it will repoint at a
published `foldcase` build (after the internal rename in step 1).
