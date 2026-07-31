import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"

import { ComponentDoc, writeComponentDocs } from "./generate.js"

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
