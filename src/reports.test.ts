import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { readFileSync } from "node:fs"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { run } from "./program.js"
import { CoverageReport, DocsDocument, LabCatalog, LabDocument, TestDocument } from "./reports.js"

const fixtures = `${import.meta.dir}/../test/fixtures`

// A `--json` run writes its document with `Console.log`, so the Console service
// is the seam that hands the document to the test instead of the terminal.
const stdoutOf = async (argv: ReadonlyArray<string>): Promise<string> => {
  const out: Array<string> = []
  const capturing: Console.Console = {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => out.push(args.join(" ")),
    error: () => {},
  }
  await Effect.runPromise(
    run(argv).pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(Console.Console)(capturing), BunServices.layer)),
    ),
  )
  expect(out).toHaveLength(1)
  return out[0] ?? ""
}

const decodeTestDocument = Schema.decodeEffect(Schema.fromJsonString(TestDocument))
const decodeDocsDocument = Schema.decodeEffect(Schema.fromJsonString(DocsDocument))
const decodeLabDocument = Schema.decodeEffect(Schema.fromJsonString(LabDocument))

describe("the --json documents are a contract a consumer can decode", () => {
  test("TestDocument decodes what `test --json` printed", async () => {
    const document = await Effect.runPromise(
      decodeTestDocument(await stdoutOf(["test", "--json", `${fixtures}/sample.showcase.ts`])),
    )

    expect(document.suite.total).toBe(2)
    expect(document.suite.passed).toBe(1)
    expect(document.suite.failed).toBe(1)
    // No `--coverage`, so the optional half is absent rather than empty.
    expect(document.coverage).toBeUndefined()
  })

  test("TestDocument carries the coverage report, and CoverageReport decodes it alone", async () => {
    const printed = await stdoutOf([
      "test",
      "--json",
      "--coverage",
      `${fixtures}/counter-logic.showcase.ts`,
    ])
    const document = await Effect.runPromise(decodeTestDocument(printed))

    expect(document.coverage?.showcases.map((showcase) => showcase.id)).toEqual([
      "counter/increment",
    ])
    // The half on its own: a consumer reading only the coverage out of the
    // document decodes it with the Schema that produced it.
    const half = Schema.decodeUnknownOption(CoverageReport)(
      (JSON.parse(printed) as { coverage: unknown }).coverage,
    )
    expect(Option.isSome(half)).toBe(true)
  })

  test("DocsDocument decodes what `docs --json` printed", async () => {
    const out = `${import.meta.dir}/../runtime-reports-docs`
    const document = await Effect.runPromise(
      decodeDocsDocument(
        await stdoutOf(["docs", "--json", `${fixtures}/schema.showcase.ts`, out]),
      ),
    )

    expect(document.docs.map((doc) => doc.component)).toEqual(["counter"])
    expect(document.docs[0]?.path.endsWith("/counter.md")).toBe(true)
    expect(document.failures).toEqual([])
    await Bun.$`rm -rf ${out}`.quiet()
  })

  test("LabDocument decodes what `lab --json` printed", async () => {
    const out = `${import.meta.dir}/../runtime-reports-lab/entry.ts`
    await Bun.$`rm -rf ${import.meta.dir}/../runtime-reports-lab`.quiet()
    const document = await Effect.runPromise(
      decodeLabDocument(
        await stdoutOf(["lab", "--json", `${fixtures}/counter-logic.showcase.ts`, out]),
      ),
    )

    expect(document.catalog.components.map((component) => component.component)).toEqual(["counter"])
    expect(document.catalog.total).toBe(1)
    expect(document.entry.status).toBe("written")
    expect(document.entry.path.endsWith("/entry.ts")).toBe(true)
    // The catalog half on its own: a reader taking only the gallery out of the
    // document decodes it with the Schema the lab itself renders from.
    const half = Schema.decodeUnknownOption(LabCatalog)(
      (JSON.parse(
        await stdoutOf(["lab", "--json", `${fixtures}/counter-logic.showcase.ts`, out]),
      ) as { catalog: unknown }).catalog,
    )
    expect(Option.isSome(half)).toBe(true)
    await Bun.$`rm -rf ${import.meta.dir}/../runtime-reports-lab`.quiet()
  })

  test("and they are published, so a consumer can import them at all", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(`${import.meta.dir}/../package.json`, "utf8"),
    )
    const exports = (manifest as { exports: Record<string, unknown> }).exports
    expect(exports["./reports"]).toEqual({
      types: "./dist/reports.d.ts",
      import: "./dist/reports.js",
    })
  })
})
