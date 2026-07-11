import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"

import { runShowcase, type Showcase } from "./runner"

describe("runShowcase", () => {
  test("reports passed when the Showcase play succeeds", async () => {
    const showcase: Showcase = { id: "button/default", play: () => {} }

    const report = await Effect.runPromise(runShowcase(showcase))

    expect(report.id).toBe("button/default")
    expect(report.status).toBe("passed")
  })
})
