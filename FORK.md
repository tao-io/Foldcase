# Foldcase — a Foldkit-native component explorer (fork of Openstory)

**Foldcase** (github.com/tao-io/Foldcase) is `tao-io`'s fork of
[millionco/openstory](https://github.com/millionco/openstory) (MIT), maintained to make
it a first-class **Foldkit** component explorer. The installable package name + import path
stay lowercase (`foldcase`, `foldcase/foldkit`) — npm forbids capitals; the tool is **Foldcase**.

**The name.** Foldcase = **fold** (Foldkit) + (show)**case** — the tool renders
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
1. ~~**Rename the internals** `openstory` → `foldcase`~~ **DONE** (v0.1.0): package `name`
   + `bin` → `foldcase`; the self-referential adapter specifiers (`openstory/{react,foldkit,
   solid,vue,svelte}` + `openstory/boot`) → `foldcase/*`, so generated stories import
   `foldcase/foldkit`. Internal runtime plumbing the prebuilt React shell relies on stays
   `openstory` on purpose (`/__openstory/*` routes, `#openstory-root`, `data-openstory-*`,
   the `openstory` postMessage source). Consumers import `foldcase/foldkit`.
2. ~~**Green on 0.127:**~~ **DONE**: the foldkit integration fixture is pointed at effect
   `4.0.0-beta.88` / foldkit `^0.127.0`; codegen-assertion tests updated to the foldcase
   specifiers. Full suite green (242 passed, 6 skipped) incl. the chromium foldkit render
   test. Consumable artifact: `pnpm pack` → `foldcase-0.1.0.tgz` (carries LICENSE + NOTICE).
3. **Foldkit-native dev instruments:** per-component **DevTools overlay** (Foldkit
   `@foldkit/devtools` `overlay` — a story-set `devTools` already flows through the adapter's
   `makeApplication({ ...config })`); **DevTools → MCP relay** in the dev server (foldkit
   vite-plugin `devToolsMcpPort`) for `dispatch_message` / `get_model` / `replay_to_keyframe`.
4. (Bigger) evaluate rebuilding the shell UI itself as a Foldkit app.
5. Consider contributing the 0.127 renderer fix back to binarytide's PR / upstream.

## Downstream consumer
Bina's Teacher-Desk **Showcase** lab (`bina` repo, scope-039,
`.../frontend/showcase/`) consumes Foldcase as a vendored `file:` tarball
(`showcase/vendor/foldcase-0.1.0.tgz`) and imports `foldcase/foldkit`, with the DevTools
overlay on all 11 Showcases + the DevTools→MCP relay wired via `showcase/vite.config.ts`.
