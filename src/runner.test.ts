import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"

import { runShowcase, type Showcase } from "./runner"

describe("runShowcase", () => {
  test("reports passed when the Showcase play succeeds", async () => {
    const showcase: Showcase = { id: "button/default", play: () => {} }

    const report = await Effect.runPromise(runShowcase(showcase))

    expect(report.id).toBe("button/default")
    expect(report.status).toBe("passed")
    expect(report.error).toBeUndefined()
  })

  test("reports failed with a serialized error when the play throws", async () => {
    const showcase: Showcase = {
      id: "button/counter",
      play: () => {
        // oxlint-disable-next-line effect/avoid-untagged-errors -- simulating the native Error a Foldkit Story/assertion throws at the boundary; the runner's job is to serialize exactly this.
        throw new Error("expected 2 clicks recorded, got 1")
      },
    }

    const report = await Effect.runPromise(runShowcase(showcase))

    expect(report.status).toBe("failed")
    expect(report.error?.name).toBe("Error")
    expect(report.error?.message).toBe("expected 2 clicks recorded, got 1")
  })

  test("awaits an async play and reports passed on resolution", async () => {
    const showcase: Showcase = {
      id: "dialog/opens",
      play: async () => {
        await Promise.resolve()
      },
    }

    const report = await Effect.runPromise(runShowcase(showcase))

    expect(report.status).toBe("passed")
  })

  test("awaits an async play and serializes a rejection as failed", async () => {
    const showcase: Showcase = {
      id: "dialog/never-opens",
      play: () => Promise.reject(new TypeError("dialog stayed closed")),
    }

    const report = await Effect.runPromise(runShowcase(showcase))

    expect(report.status).toBe("failed")
    expect(report.error?.name).toBe("TypeError")
    expect(report.error?.message).toBe("dialog stayed closed")
  })
})
