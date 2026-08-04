import type { Showcase } from "../../src/runner"

// A pure showcase module fixture (no Foldkit): exactly the shape a real
// `*.showcase.ts` file exports for `foldcase test` to discover.
export const showcases: ReadonlyArray<Showcase> = [
  // The `mount` is the lab's seam, declared here so the loader is exercised
  // over a catalog that carries one. It draws nothing: the loader only imports
  // the module, it never calls `mount`, so the fixture needs no DOM.
  { id: "sample/passes", play: () => {}, mount: () => () => {} },
  {
    id: "sample/fails",
    play: () => {
      // oxlint-disable-next-line effect/avoid-untagged-errors -- fixture simulating a Story assertion throw.
      throw new Error("sample assertion failed")
    },
  },
]
