import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { loadCatalogFromDir } from "./catalog"

const fixtures = `${import.meta.dir}/../../test/fixtures`
const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

describe("loadCatalogFromDir", () => {
  test("discovers *.showcase.ts under a directory and exposes them as a catalog", async () => {
    const listing = await Effect.runPromise(
      loadCatalogFromDir(fixtures).pipe(
        Effect.flatMap((catalog) => catalog.list),
        Effect.provide(PlatformLive),
      ),
    )

    const ids = listing.showcases.map((entry) => entry.id)
    expect(ids).toContain("sample/passes")
    expect(ids).toContain("sample/fails")
  })
})
