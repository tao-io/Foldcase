import { answer } from "./lib"

import type { Showcase } from "../../src/runner"

// A showcase the one loader reads happily under Bun but the Node coverage
// collector cannot import, because it imports a directory. It lives outside
// `test/fixtures` so the discovery-based suites never pick it up: its only job
// is to prove `--coverage` reports what it could not measure.
export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "uncollectable/dir-import",
    play: () => {
      if (answer() !== 42) {
        // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
        throw new Error("answer() should be 42")
      }
    },
  },
]
