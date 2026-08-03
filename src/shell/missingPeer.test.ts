import { describe, expect, test } from "bun:test"

import { missingPeerNotice } from "./missingPeer.js"

/** Node: a plain `Error` carrying the code, with the package quoted in the message. */
const nodeCause = (message: string): unknown => {
  // oxlint-disable-next-line effect/avoid-untagged-errors -- standing in for Node's own loader throw.
  const error = new Error(message)
  return Object.assign(error, { code: "ERR_MODULE_NOT_FOUND" })
}

/** Bun: a `ResolveMessage`, which carries the specifier as a field of its own. */
const bunCause = (message: string, specifier: string): unknown => {
  // oxlint-disable-next-line effect/avoid-untagged-errors -- standing in for Bun's own resolver throw.
  const error = new Error(message)
  return Object.assign(error, { code: "ERR_MODULE_NOT_FOUND", specifier })
}

describe("missingPeerNotice", () => {
  test("tells a Node consumer what to install and what to run instead", () => {
    const notice = missingPeerNotice(
      nodeCause(
        "Cannot find package '@effect/platform-node' imported from /app/node_modules/foldcase/dist/main.js",
      ),
      "@effect/platform-node",
      "foldcase-bun",
    )
    expect(notice).toBe(
      [
        "foldcase: this bin needs the optional peer @effect/platform-node, which is not installed.",
        "  install it:  npm i -D @effect/platform-node",
        "  or run the other bin instead:  foldcase-bun",
      ].join("\n"),
    )
  })

  test("reads Bun's ResolveMessage, which names the specifier in a field", () => {
    const notice = missingPeerNotice(
      bunCause(
        "ENOENT while resolving package '@effect/platform-bun' from '/app/node_modules/foldcase/dist/main.bun.js'",
        "@effect/platform-bun",
      ),
      "@effect/platform-bun",
      "foldcase",
    )
    expect(notice).toContain("@effect/platform-bun")
    expect(notice).toContain("npm i -D @effect/platform-bun")
    expect(notice).toContain("foldcase")
  })

  test("says nothing about a module a consumer's own file failed to find", () => {
    expect(
      missingPeerNotice(
        nodeCause("Cannot find module '/app/Button.js' imported from /app/demo.showcase.ts"),
        "@effect/platform-node",
        "foldcase-bun",
      ),
    ).toBeUndefined()
    expect(
      missingPeerNotice(
        bunCause("Cannot find module './Button' from '/app/demo.showcase.ts'", "./Button"),
        "@effect/platform-bun",
        "foldcase",
      ),
    ).toBeUndefined()
  })

  test("says nothing about a different package, however close its name", () => {
    expect(
      missingPeerNotice(
        nodeCause("Cannot find package 'effect' imported from /app/dist/main.js"),
        "@effect/platform-node",
        "foldcase-bun",
      ),
    ).toBeUndefined()
    expect(
      missingPeerNotice(
        nodeCause("Cannot find package '@effect/platform-node-shared' imported from /app/x.js"),
        "@effect/platform-node",
        "foldcase-bun",
      ),
    ).toBeUndefined()
  })

  test("says nothing about an error that is not a failed resolution", () => {
    expect(
      // oxlint-disable-next-line effect/avoid-untagged-errors -- an unrelated throw from the imported module's own body.
      missingPeerNotice(new TypeError("x is not a function"), "@effect/platform-node", "foldcase-bun"),
    ).toBeUndefined()
    expect(missingPeerNotice("@effect/platform-node", "@effect/platform-node", "foldcase-bun"))
      .toBeUndefined()
    expect(missingPeerNotice(undefined, "@effect/platform-node", "foldcase-bun")).toBeUndefined()
  })
})
