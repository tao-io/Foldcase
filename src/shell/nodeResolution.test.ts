import { describe, expect, test } from "bun:test"

import { resolutionCandidates, resolveTypeScriptSource } from "./nodeResolution"

describe("resolutionCandidates", () => {
  test("retries a bare relative specifier with the source extensions", () => {
    expect(resolutionCandidates("./Button")).toEqual([
      "./Button.ts",
      "./Button.tsx",
      "./Button.mts",
      "./Button.js",
      "./Button.mjs",
    ])
    expect(resolutionCandidates("../lib/counter")).toContain("../lib/counter.ts")
  })

  test("maps a NodeNext `.js` specifier onto the TypeScript source behind it", () => {
    expect(resolutionCandidates("./Button.js")).toEqual(["./Button.ts", "./Button.tsx"])
  })

  test("leaves a bare package specifier and an already-resolvable extension alone", () => {
    expect(resolutionCandidates("effect/Schema")).toEqual([])
    expect(resolutionCandidates("foldcase")).toEqual([])
    expect(resolutionCandidates("./Button.ts")).toEqual([])
    expect(resolutionCandidates("./Button.mjs")).toEqual([])
  })
})

describe("resolveTypeScriptSource", () => {
  const resolver = (present: ReadonlyArray<string>) => (specifier: string): string => {
    if (!present.includes(specifier)) {
      // oxlint-disable-next-line effect/avoid-untagged-errors -- standing in for Node's own resolver throw.
      throw new Error(`ERR_MODULE_NOT_FOUND: ${specifier}`)
    }
    return specifier
  }

  test("prefers Node's own resolution", () => {
    expect(resolveTypeScriptSource("./Button", {}, resolver(["./Button"]))).toBe("./Button")
  })

  test("falls back to the TypeScript source behind the specifier", () => {
    expect(resolveTypeScriptSource("./Button", {}, resolver(["./Button.ts"]))).toBe("./Button.ts")
    expect(resolveTypeScriptSource("./Button.js", {}, resolver(["./Button.ts"]))).toBe("./Button.ts")
  })

  test("re-raises Node's own error when nothing resolves", () => {
    expect(() => resolveTypeScriptSource("./Gone", {}, resolver([]))).toThrow(
      "ERR_MODULE_NOT_FOUND: ./Gone",
    )
  })
})
