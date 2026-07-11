import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"

import { ShowcaseDoc, writeShowcaseDocs } from "./generate"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const docs = [
  new ShowcaseDoc({ id: "counter/basic", markdown: "# counter/basic\n\nbody\n" }),
  new ShowcaseDoc({ id: "widget/opaque", markdown: "# widget/opaque\n\nnote\n" }),
]

describe("writeShowcaseDocs", () => {
  test("writes one slugged Markdown file per Showcase into the target dir", async () => {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()
      const written = yield* writeShowcaseDocs(dir, docs)
      const first = yield* fs.readFileString(written[0]?.path ?? "")
      return { written, first }
    })

    const { written, first } = await Effect.runPromise(
      Effect.scoped(program).pipe(Effect.provide(PlatformLive)),
    )

    // A slug replaces the `/` in the id so the filename is filesystem-safe.
    expect(written.map((entry) => entry.path.split("/").pop())).toEqual([
      "counter-basic.md",
      "widget-opaque.md",
    ])
    expect(written.map((entry) => entry.id)).toEqual(["counter/basic", "widget/opaque"])
    // The written content is exactly the doc's Markdown.
    expect(first).toBe("# counter/basic\n\nbody\n")
  })
})
