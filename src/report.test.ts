import { describe, expect, test } from "bun:test"

import { formatSuite, ShowcaseReport, SerializedError, suiteExitCode, SuiteReport } from "./runner.js"

const passing = new ShowcaseReport({ id: "button/default", status: "passed" })
const failing = new ShowcaseReport({
  id: "button/counter",
  status: "failed",
  error: new SerializedError({ name: "Error", message: "counter did not rise" }),
})

const suiteOf = (reports: ReadonlyArray<ShowcaseReport>): SuiteReport => {
  const passed = reports.filter((report) => report.status === "passed").length
  return new SuiteReport({
    total: reports.length,
    passed,
    failed: reports.length - passed,
    reports,
  })
}

describe("suiteExitCode", () => {
  test("is 0 when every Showcase passed", () => {
    expect(suiteExitCode(suiteOf([passing, passing]))).toBe(0)
  })

  test("is 1 when any Showcase failed", () => {
    expect(suiteExitCode(suiteOf([passing, failing]))).toBe(1)
  })
})

describe("formatSuite", () => {
  test("marks each Showcase and shows the failure message and a summary", () => {
    const text = formatSuite(suiteOf([passing, failing]))

    expect(text).toContain("button/default")
    expect(text).toContain("button/counter")
    expect(text).toContain("counter did not rise")
    expect(text).toContain("2 total")
    expect(text).toContain("1 passed")
    expect(text).toContain("1 failed")
  })
})
