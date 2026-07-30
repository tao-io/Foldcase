import type { Showcase } from "../../src/runner"
import { increment } from "./lib/counter"

// A showcase whose play calls `increment` (but never `decrement`) in a separate
// module, so `foldcase test --coverage` records real, partial coverage of the
// code the play executed — the cross-file analogue of a component's update.
export const showcases: ReadonlyArray<Showcase> = [
  {
    id: "counter/increment",
    play: () => {
      if (increment(1) !== 2) {
        // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
        throw new Error("increment(1) should be 2")
      }
    },
  },
]
