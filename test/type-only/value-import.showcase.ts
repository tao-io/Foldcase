import { increment, start } from "./lib/counter.ts"

import type { Showcase } from "../../src/runner"

// A catalog Bun loads and Node does not: the module it reaches imports a type as
// a value, and Node's type stripping leaves that import nothing to bind to. It
// lives outside `test/fixtures` so the discovery-based suites never pick it up;
// its only job is to prove the failed-file report names the cause and the fix.
//
// The relative specifiers carry their `.ts` extension so a bare `node` resolves
// them. The `foldcase` bin would resolve them either way — its shell installs
// the retry hook in `src/shell/nodeResolution.ts` — and keeping resolution out
// of the way leaves exactly one reason this file will not load under Node.
export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "type-only/value-import",
    play: () => {
      if (increment(start()) !== 1) {
        // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
        throw new Error("increment(start()) should be 1")
      }
    },
  },
]
