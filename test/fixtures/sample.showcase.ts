import type { Showcase } from "../../src/runner"

// A pure showcase module fixture (no Foldkit): exactly the shape a real
// `*.showcase.ts` file exports for `foldcase test` to discover.
export const showcases: ReadonlyArray<Showcase> = [
  { id: "sample/passes", play: () => {} },
  {
    id: "sample/fails",
    play: () => {
      // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
      throw new Error("sample assertion failed")
    },
  },
]
