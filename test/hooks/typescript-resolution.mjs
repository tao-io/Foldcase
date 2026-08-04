// The Node shell's resolution policy, installed before a module is loaded.
//
// `src/main.ts` and `src/mcp/freshRunChild.ts` install it themselves, at the
// top of their own body — which is late enough for the `*.showcase.ts` files
// they load dynamically, and too late for their own static imports. Running
// either one from *source* under Node needs the hook in place first, because
// `../cli.js` is `cli.ts` on disk until `tsc` has run.
//
// So this exists for the suites that drive the Node side of the tool without a
// build: `node --import ./test/hooks/typescript-resolution.mjs <entry.ts>`. It
// is not part of the shipped tool, and it declares no policy of its own — it
// installs `src/shell/nodeResolution.ts`, the one the Node bin installs.

import { registerHooks } from "node:module"

import { resolveTypeScriptSource } from "../../src/shell/nodeResolution.ts"

registerHooks({ resolve: resolveTypeScriptSource })
