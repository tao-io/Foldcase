import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"

import { checkComponentDocs, ComponentDoc, writeComponentDocs } from "./generate.js"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const docs = [
  new ComponentDoc({
    component: "ui/counter",
    showcases: ["ui/counter/basic", "ui/counter/reset"],
    markdown: "# ui/counter\n\nbody\n",
  }),
  new ComponentDoc({
    component: "widget/opaque",
    showcases: ["widget/opaque"],
    markdown: "# widget/opaque\n\nnote\n",
  }),
]

describe("writeComponentDocs", () => {
  test("writes one slugged Markdown file per component into the target dir", async () => {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()
      const written = yield* writeComponentDocs(dir, docs)
      const first = yield* fs.readFileString(written[0]?.path ?? "")
      return { written, first }
    })

    const { written, first } = await Effect.runPromise(
      Effect.scoped(program).pipe(Effect.provide(PlatformLive)),
    )

    // A slug replaces the `/` in the component name so the filename is
    // filesystem-safe. One file per component, whatever its Showcase count.
    expect(written.map((entry) => entry.path.split("/").pop())).toEqual([
      "ui-counter.md",
      "widget-opaque.md",
    ])
    expect(written.map((entry) => entry.component)).toEqual(["ui/counter", "widget/opaque"])
    // The written content is exactly the doc's Markdown.
    expect(first).toBe("# ui/counter\n\nbody\n")
  })
})

describe("checkComponentDocs", () => {
  test("names the documents the directory does not already hold, and writes nothing", async () => {
    const edited = new ComponentDoc({
      component: "ui/counter",
      showcases: ["ui/counter/basic"],
      markdown: "# ui/counter\n\nbody, one word longer\n",
    })
    const added = new ComponentDoc({
      component: "extra",
      showcases: ["extra/one"],
      markdown: "# extra\n",
    })

    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()
      yield* writeComponentDocs(dir, docs)
      const current = yield* checkComponentDocs(dir, docs)
      const drifted = yield* checkComponentDocs(dir, [edited, docs[1] as ComponentDoc, added])
      return { current, drifted, entries: yield* fs.readDirectory(dir) }
    })

    const { current, drifted, entries } = await Effect.runPromise(
      Effect.scoped(program).pipe(Effect.provide(PlatformLive)),
    )

    // What is on disk is what would be written: no drift.
    expect(current).toEqual([])
    // A different body is `changed`; a document with no file at all is `missing`;
    // the one that matches is not named.
    expect(drifted.map((entry) => [entry.component, entry.reason])).toEqual([
      ["ui/counter", "changed"],
      ["extra", "missing"],
    ])
    expect(drifted.map((entry) => entry.path.split("/").pop())).toEqual([
      "ui-counter.md",
      "extra.md",
    ])
    // A check is read-only — the missing document must not appear on disk.
    expect(entries.toSorted()).toEqual(["ui-counter.md", "widget-opaque.md"])
  })

  test("reports every document as missing when the directory is not there, and does not create it", async () => {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()
      const absent = `${dir}/never-written`
      const stale = yield* checkComponentDocs(absent, docs)
      return { stale, exists: yield* fs.exists(absent) }
    })

    const { exists, stale } = await Effect.runPromise(
      Effect.scoped(program).pipe(Effect.provide(PlatformLive)),
    )

    expect(stale.map((entry) => entry.reason)).toEqual(["missing", "missing"])
    expect(exists).toBe(false)
  })
})
