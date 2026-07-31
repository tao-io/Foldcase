import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"

import type { Showcase } from "../runner.js"
import { FoldcaseCatalog, makeCatalog } from "./catalog.js"
import { makeFoldcaseMcpServer } from "./server.js"

const showcases: ReadonlyArray<Showcase> = [{ id: "probe/one", play: () => {} }]

// A catalog that takes time to arrive — which the live one always does: it
// walks a directory and dynamically `import()`s every `*.showcase.ts` under it.
// The delay is the scenario under test, not a synchronization device.
const SlowCatalog = Layer.effect(FoldcaseCatalog)(
  Effect.sleep("20 millis").pipe(Effect.as(makeCatalog(showcases))),
)

const line = (message: object): string => `${JSON.stringify(message)}\n`

// The opening exchange of every MCP host that discovers its tools once at
// startup: initialize, the initialized notification, then `tools/list` — all
// written before the server has had a chance to answer any of them.
const CLIENT_INPUT =
  line({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "foldcase-test", version: "0" },
    },
  }) +
  line({ jsonrpc: "2.0", method: "notifications/initialized" }) +
  line({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })

const asText = (chunk: string | Uint8Array): string =>
  typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)

// The JSON-RPC id of the `tools/list` request — the transcript is complete once
// its response has been written.
const TOOLS_LIST_RESPONSE = `"id":2`

/**
 * Drive the stdio MCP server with {@link CLIENT_INPUT} and return everything it
 * wrote up to and including the `tools/list` response.
 *
 * The server is launched in a forked fiber because the stdio protocol
 * interrupts its owning fiber when stdin ends, and `Stream.never` keeps stdin
 * open so it does not end mid-exchange.
 */
const listToolsAtStartup = Effect.gen(function* () {
  const written = yield* Queue.make<string>()
  const stdio = Stdio.layerTest({
    stdin: Stream.fromArray([new TextEncoder().encode(CLIENT_INPUT)]).pipe(
      Stream.concat(Stream.never),
    ),
    stdout: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(written, asText(chunk))),
  })
  yield* Effect.forkScoped(
    Layer.launch(makeFoldcaseMcpServer(SlowCatalog).pipe(Layer.provide(stdio))),
  )
  return yield* Stream.fromQueue(written).pipe(
    Stream.scan("", (transcript: string, chunk: string) => transcript + chunk),
    Stream.filter((transcript) => transcript.includes(TOOLS_LIST_RESPONSE)),
    Stream.runHead,
  )
}).pipe(Effect.scoped, Effect.timeout("10 seconds"))

describe("makeFoldcaseMcpServer", () => {
  test("answers the first tools/list with the whole catalog, not an empty list", async () => {
    const transcript = Option.getOrElse(await Effect.runPromise(listToolsAtStartup), () => "")

    // An MCP host that discovers tools once, at startup, sees exactly this
    // answer. An empty `tools` array there makes the agent surface useless for
    // the rest of the session, however quickly the catalog finishes loading.
    expect(transcript).toContain("foldcase_list_showcases")
    expect(transcript).toContain("foldcase_get_showcase_schema")
    expect(transcript).toContain("foldcase_run_showcase")
  })

  test("advertises the tools capability in the initialize response", async () => {
    const transcript = Option.getOrElse(await Effect.runPromise(listToolsAtStartup), () => "")

    // The capability is computed when `initialize` is answered, so it is the
    // earliest observable proof that the verbs were registered before the
    // transport started reading. A host that trusts capabilities would not even
    // send `tools/list` without it.
    expect(transcript).toContain(`"tools":{"listChanged":true}`)
  })
})
