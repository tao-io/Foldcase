import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { BunFileSystem, BunPath } from "@effect/platform-bun"

import { discoverShowcaseFiles, docsFromFiles, runSuiteFromFiles } from "./cli"

const fixture = (name: string): string => `${import.meta.dir}/../test/fixtures/${name}`
const fixtures = `${import.meta.dir}/../test/fixtures`
const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

describe("discoverShowcaseFiles", () => {
  test("finds every *.showcase.ts under a directory, sorted", async () => {
    const files = await Effect.runPromise(
      discoverShowcaseFiles(fixtures).pipe(Effect.provide(PlatformLive)),
    )

    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.every((path) => path.endsWith(".showcase.ts"))).toBe(true)
    expect(files.some((path) => path.endsWith("sample.showcase.ts"))).toBe(true)
    const ascending = files.every((path, index) => index === 0 || (files[index - 1] ?? "") <= path)
    expect(ascending).toBe(true)
  })
})

describe("runSuiteFromFiles", () => {
  test("imports a showcase module and runs its exported showcases", async () => {
    const suite = await Effect.runPromise(runSuiteFromFiles([fixture("sample.showcase.ts")]))

    expect(suite.total).toBe(2)
    expect(suite.passed).toBe(1)
    expect(suite.failed).toBe(1)
    expect(suite.reports.map((report) => report.id)).toEqual(["sample/passes", "sample/fails"])
  })

  test("fails with a typed ShowcaseModuleError naming the missing module", async () => {
    const error = await Effect.runPromise(
      Effect.flip(runSuiteFromFiles([fixture("does-not-exist.ts")])),
    )

    expect(error._tag).toBe("foldcase/ShowcaseModuleError")
    expect(error.path).toContain("does-not-exist.ts")
    expect(error.reason.length).toBeGreaterThan(0)
  })

  test("the failure a runtime prints carries the path and the reason", async () => {
    // The CLI shell hands an unhandled failure to `runMain`, which prints the
    // error's `message`. An empty message reads as "foldcase/ShowcaseModuleError:"
    // and tells the user nothing about *why* the module would not load.
    const error = await Effect.runPromise(
      Effect.flip(runSuiteFromFiles([fixture("does-not-exist.ts")])),
    )

    expect(error.message).toContain("does-not-exist.ts")
    expect(error.message).toContain(error.reason)
    expect(String(error)).toContain(error.reason)
  })

  test("rejects a showcase whose message is not an Effect Schema", async () => {
    const malformed = `${import.meta.dir}/../test/malformed/bad-message.showcase.ts`
    const error = await Effect.runPromise(Effect.flip(runSuiteFromFiles([malformed])))

    expect(error._tag).toBe("foldcase/ShowcaseModuleError")
  })
})

describe("docsFromFiles", () => {
  test("renders a Model/Message Schema table autodoc per Showcase", async () => {
    const docs = await Effect.runPromise(docsFromFiles([fixture("schema.showcase.ts")]))

    expect(docs.map((doc) => doc.id)).toEqual(["counter/schema"])
    const markdown = docs[0]?.markdown ?? ""
    expect(markdown).toContain("# counter/schema")
    expect(markdown).toContain("## Messages")
    expect(markdown).toContain("`Increment`")
    expect(markdown).toContain("`SetLabel`")
    expect(markdown).toContain("## Model")
    expect(markdown).toContain("`count`")
    expect(markdown).toContain("number")
  })
})
