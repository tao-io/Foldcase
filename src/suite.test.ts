import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"

import { runShowcases } from "./runner"
import type { Showcase } from "./runner"

describe("runShowcases", () => {
  test("aggregates a suite report with pass/fail counts and per-Showcase reports", async () => {
    const showcases: ReadonlyArray<Showcase> = [
      { id: "button/default", play: () => {} },
      {
        id: "button/counter",
        play: () => {
          // oxlint-disable-next-line effect/avoid-untagged-errors -- simulating a Story assertion throw at the boundary.
          throw new Error("counter did not rise")
        },
      },
      { id: "dialog/opens", play: async () => {} },
    ]

    const suite = await Effect.runPromise(runShowcases(showcases))

    expect(suite.total).toBe(3)
    expect(suite.passed).toBe(2)
    expect(suite.failed).toBe(1)
    expect(suite.reports.map((report) => report.id)).toEqual([
      "button/default",
      "button/counter",
      "dialog/opens",
    ])
    const failed = suite.reports.find((report) => report.status === "failed")
    expect(failed?.error?.message).toBe("counter did not rise")
  })

  test("an empty suite reports zero of everything", async () => {
    const suite = await Effect.runPromise(runShowcases([]))

    expect(suite.total).toBe(0)
    expect(suite.passed).toBe(0)
    expect(suite.failed).toBe(0)
  })
})
