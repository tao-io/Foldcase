import { describe, expect, test } from "bun:test"

import { labEntryModule } from "./scaffold.js"

const entry = "/app/src/foldcase-lab.entry.ts"

describe("labEntryModule", () => {
  test("imports each catalog by a relative specifier, extension dropped", () => {
    const source = labEntryModule(entry, [
      "/app/src/counter.showcase.ts",
      "/app/src/ui/picker.showcase.ts",
    ])

    expect(source).toContain('from "./counter.showcase"')
    expect(source).toContain('from "./ui/picker.showcase"')
  })

  test("walks up out of the entry's own directory for a catalog above it", () => {
    const source = labEntryModule("/app/lab/entry.ts", ["/app/src/ui/counter.showcase.ts"])

    expect(source).toContain('from "../src/ui/counter.showcase"')
  })

  test("assembles the load the lab takes, and starts the runtime with it", () => {
    const source = labEntryModule(entry, [
      "/app/src/counter.showcase.ts",
      "/app/src/ui/picker.showcase.ts",
    ])

    expect(source).toContain('import { makeLabApplication } from "foldcase/lab"')
    expect(source).toContain('import type { CatalogLoad } from "foldcase/cli"')
    expect(source).toContain('import { Runtime } from "foldkit"')
    // The loader carries the file beside each record, and so does the entry:
    // the lab's details panel says which file a component was read from.
    expect(source).toContain('"/app/src/counter.showcase.ts"')
    expect(source).toContain('"/app/src/ui/picker.showcase.ts"')
    expect(source).toContain("const load: CatalogLoad = {")
    expect(source).toContain("Runtime.run(")
  })

  test("names each catalog once, so two files cannot collide on one binding", () => {
    const source = labEntryModule(entry, [
      "/app/src/counter.showcase.ts",
      "/app/src/ui/picker.showcase.ts",
    ])

    expect(source).toContain("catalog0")
    expect(source).toContain("catalog1")
  })
})
