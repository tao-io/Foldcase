import { describe, expect, test } from "bun:test"

import { tallyFile } from "./coverage"

// A tiny deterministic source: three 4-char lines, each followed by a newline.
//   line 1: offsets  0– 3  (\n at 4)
//   line 2: offsets  5– 8  (\n at 9)
//   line 3: offsets 10–13  (\n at 14)   length = 15
const SOURCE = "AAAA\nBBBB\nCCCC\n"

describe("tallyFile", () => {
  test("maps V8 block ranges to covered/executable lines and function counts", () => {
    // Module wrapper covers the whole file; `f` (line 2) ran; `g` (line 3) did not.
    const tally = tallyFile(SOURCE, [
      { functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 15, count: 1 }] },
      { functionName: "f", isBlockCoverage: true, ranges: [{ startOffset: 5, endOffset: 10, count: 1 }] },
      { functionName: "g", isBlockCoverage: true, ranges: [{ startOffset: 10, endOffset: 15, count: 0 }] },
    ])

    // g's line is executable but its inner count-0 range overrides the module's
    // count-1 wrapper, so line 3 is a miss.
    expect(tally.executableLines).toBe(3)
    expect(tally.coveredLines).toBe(2)
    // "" and f have a positive outer range; g does not.
    expect(tally.totalFunctions).toBe(3)
    expect(tally.coveredFunctions).toBe(2)
  })

  test("a fully-uncovered file reports zero covered lines and functions", () => {
    const tally = tallyFile(SOURCE, [
      { functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 15, count: 0 }] },
    ])

    expect(tally.executableLines).toBe(3)
    expect(tally.coveredLines).toBe(0)
    expect(tally.totalFunctions).toBe(1)
    expect(tally.coveredFunctions).toBe(0)
  })
})
