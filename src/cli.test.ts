import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { BunFileSystem, BunPath } from "@effect/platform-bun"

import {
  discoverShowcaseFiles,
  docsFromFiles,
  loadFailureReason,
  loadShowcasesFromFiles,
  runSuiteFromFiles,
} from "./cli.js"
import { formatSuite, suiteExitCode } from "./runner.js"

const fixture = (name: string): string => `${import.meta.dir}/../test/fixtures/${name}`
const malformed = (name: string): string => `${import.meta.dir}/../test/malformed/${name}`
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

describe("loadFailureReason", () => {
  test("renders an ordinary cause the way String does", () => {
    expect(loadFailureReason(new Error("boom"))).toBe("Error: boom")
    expect(loadFailureReason("Cannot find module './picker'")).toBe("Cannot find module './picker'")
    expect(loadFailureReason(new TypeError("not a function"))).toBe("TypeError: not a function")
  })

  test("leaves a SyntaxError that is not the type-stripping one alone", () => {
    expect(loadFailureReason(new SyntaxError("Unexpected token '<'"))).toBe(
      "SyntaxError: Unexpected token '<'",
    )
  })

  test("explains Node's type-stripping failure, naming the import to rewrite", () => {
    const reason = loadFailureReason(
      new SyntaxError("The requested module 'foldkit/html' does not provide an export named 'Html'"),
    )

    expect(reason).toContain("does not provide an export named 'Html'")
    expect(reason).toContain("Node strips types")
    expect(reason).toContain("import type { Html } from 'foldkit/html'")
    expect(reason).toContain("foldcase-bun")
  })

  test("explains it without names when the message does not name them", () => {
    // Node's wording is not a contract. A message that no longer parses still
    // earns the explanation — it just does not get a tailored `import type`.
    const reason = loadFailureReason(new SyntaxError("does not provide an export named"))

    expect(reason).toContain("Node strips types")
    expect(reason).toContain("import type")
    expect(reason).not.toContain("undefined")
    expect(reason).not.toContain("{  }")
  })
})

describe("loadShowcasesFromFiles", () => {
  test("loads what it can and collects the files it could not, rather than stopping", async () => {
    const load = await Effect.runPromise(
      loadShowcasesFromFiles([
        malformed("broken-import.showcase.ts"),
        fixture("sample.showcase.ts"),
      ]),
    )

    // The good file is loaded even though it is listed after the bad one.
    expect(load.showcases.map((showcase) => showcase.id)).toEqual([
      "sample/passes",
      "sample/fails",
    ])
    expect(load.failures.map((failure) => failure.path)).toEqual([
      malformed("broken-import.showcase.ts"),
    ])
    expect(load.failures[0]?.reason.length).toBeGreaterThan(0)
  })

  test("says which file each Showcase was read from", async () => {
    const load = await Effect.runPromise(
      loadShowcasesFromFiles([fixture("sample.showcase.ts"), fixture("schema.showcase.ts")]),
    )

    expect(load.loaded.map((entry) => [entry.showcase.id, entry.file])).toEqual([
      ["sample/passes", fixture("sample.showcase.ts")],
      ["sample/fails", fixture("sample.showcase.ts")],
      ["counter/schema", fixture("schema.showcase.ts")],
    ])
  })

  test("a module that exports the wrong shape is a failure for that file only", async () => {
    const load = await Effect.runPromise(
      loadShowcasesFromFiles([malformed("bad-message.showcase.ts"), fixture("sample.showcase.ts")]),
    )

    expect(load.failures.map((failure) => failure.path)).toEqual([
      malformed("bad-message.showcase.ts"),
    ])
    expect(load.failures[0]?.reason).toContain("showcases")
    expect(load.showcases).toHaveLength(2)
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

  test("reports an unloadable module as a failed file and runs the rest anyway", async () => {
    const suite = await Effect.runPromise(
      runSuiteFromFiles([
        malformed("broken-import.showcase.ts"),
        fixture("sample.showcase.ts"),
      ]),
    )

    // One file that will not import used to abort the whole run. It is now a
    // reported failure for that file, keyed by its path, and everything else
    // still runs — while the suite verdict stays failed.
    expect(suite.reports.map((report) => report.id)).toEqual([
      malformed("broken-import.showcase.ts"),
      "sample/passes",
      "sample/fails",
    ])
    expect(suite.total).toBe(3)
    expect(suite.passed).toBe(1)
    expect(suite.failed).toBe(2)
    expect(suiteExitCode(suite)).toBe(1)
  })

  test("every report names the file it came from, run or unloadable", async () => {
    const suite = await Effect.runPromise(
      runSuiteFromFiles([malformed("broken-import.showcase.ts"), fixture("sample.showcase.ts")]),
    )

    expect(suite.reports.map((report) => report.file)).toEqual([
      malformed("broken-import.showcase.ts"),
      fixture("sample.showcase.ts"),
      fixture("sample.showcase.ts"),
    ])
    // The human summary is unchanged: the file is data, not a pass/fail line.
    expect(formatSuite(suite)).toContain("  ✓ sample/passes")
  })

  test("the reported failure says which file would not load and why", async () => {
    const suite = await Effect.runPromise(runSuiteFromFiles([fixture("does-not-exist.ts")]))

    const report = suite.reports[0]
    expect(report?.status).toBe("failed")
    expect(report?.id).toContain("does-not-exist.ts")
    expect(report?.error?.name).toBe("foldcase/ShowcaseModuleError")
    expect(report?.error?.message.length).toBeGreaterThan(0)
    expect(formatSuite(suite)).toContain("does-not-exist.ts")
  })

  test("rejects a showcase whose message is not an Effect Schema", async () => {
    const suite = await Effect.runPromise(
      runSuiteFromFiles([malformed("bad-message.showcase.ts")]),
    )

    expect(suite.failed).toBe(1)
    expect(suite.reports[0]?.error?.name).toBe("foldcase/ShowcaseModuleError")
  })
})

describe("docsFromFiles", () => {
  test("renders a Model/Message Schema table autodoc per Showcase", async () => {
    const { docs } = await Effect.runPromise(docsFromFiles([fixture("schema.showcase.ts")]))

    expect(docs.map((doc) => doc.component)).toEqual(["counter/schema"])
    const markdown = docs[0]?.markdown ?? ""
    expect(markdown).toContain("# counter/schema")
    expect(markdown).toContain("## Messages")
    expect(markdown).toContain("`Increment`")
    expect(markdown).toContain("`SetLabel`")
    expect(markdown).toContain("## Model")
    expect(markdown).toContain("`count`")
    expect(markdown).toContain("number")
  })

  test("hands back the files it could not load instead of refusing to document any", async () => {
    const { docs, failures } = await Effect.runPromise(
      docsFromFiles([malformed("broken-import.showcase.ts"), fixture("schema.showcase.ts")]),
    )

    expect(docs.map((doc) => doc.component)).toEqual(["counter/schema"])
    expect(failures.map((failure) => failure.path)).toEqual([
      malformed("broken-import.showcase.ts"),
    ])
  })
})
