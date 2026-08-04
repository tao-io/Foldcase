import { describe, expect, test } from "bun:test"
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"

import { agentsSection, initialize, InitFileError } from "./init.js"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

/**
 * Run `initialize` over a directory prepared by `given`, and read back what it
 * left there. A temp directory per test, so nothing a run writes can leak into
 * the next one — or into this repository, which already has both files.
 */
const wiring = <A>(
  given: (dir: string) => Effect.Effect<void, unknown, FileSystem.FileSystem>,
  read: (dir: string) => Effect.Effect<A, unknown, FileSystem.FileSystem>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped()
        yield* given(dir)
        const artifacts = yield* initialize(dir)
        return { artifacts, held: yield* read(dir) }
      }),
    ).pipe(Effect.provide(PlatformLive)),
  ) as Promise<{ artifacts: ReadonlyArray<{ file: string; action: string }>; held: A }>

/**
 * The same, for a run that must fail: the error it failed with, and the file as
 * it stands afterwards — a refusal that rewrote the file would be no refusal.
 */
const refusing = <A>(
  given: (dir: string) => Effect.Effect<void, unknown, FileSystem.FileSystem>,
  read: (dir: string) => Effect.Effect<A, unknown, FileSystem.FileSystem>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped()
        yield* given(dir)
        const error = yield* Effect.flip(initialize(dir))
        return { error, written: yield* read(dir) }
      }),
    ).pipe(Effect.provide(PlatformLive)),
  ) as Promise<{ error: unknown; written: A }>

const nothing = () => Effect.void

/** Prepare the target with a file of the given text, or a directory per name. */
const write = (name: string, text: string) => (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(`${dir}/${name}`, text)
  })

const makeDirectory = (name: string) => (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(`${dir}/${name}`, { recursive: true })
  })

const fileNamed = (name: string) => (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(`${dir}/${name}`)
  })

const mcpJson = fileNamed(".mcp.json")
const agentsMd = fileNamed("AGENTS.md")

describe("initialize — .mcp.json", () => {
  test("creates it with the npx entry when the directory has none", async () => {
    const { artifacts, held } = await wiring(nothing, mcpJson)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      ".mcp.json",
      "created",
    ])
    expect(JSON.parse(held)).toEqual({
      mcpServers: {
        foldcase: { command: "npx", args: ["foldcase", "mcp"] },
      },
    })
  })

  test("names the Bun bin when the target's own lockfile is Bun's", async () => {
    // The runtime is read off the consumer's repository, not off whichever bin
    // happens to be running this — their host launches their lockfile's.
    const { held } = await wiring(write("bun.lock", ""), mcpJson)

    expect(JSON.parse(held).mcpServers.foldcase).toEqual({
      command: "bunx",
      args: ["foldcase-bun", "mcp"],
    })
  })

  test("reads the binary lockfile too, which older Bun projects carry", async () => {
    const { held } = await wiring(write("bun.lockb", ""), mcpJson)

    expect(JSON.parse(held).mcpServers.foldcase.command).toBe("bunx")
  })

  test("merges into a config that has servers of its own, losing none of it", async () => {
    const held = JSON.stringify({
      $schema: "https://example.test/mcp.json",
      mcpServers: {
        postgres: { command: "npx", args: ["-y", "@some/postgres"], env: { URL: "postgres://x" } },
      },
      other: { keep: [1, true, null] },
    })

    const { artifacts, held: written } = await wiring(write(".mcp.json", held), mcpJson)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      ".mcp.json",
      "updated",
    ])
    // Every key the consumer had is still there, values and all — this file is
    // theirs, and `init` is a guest in it.
    expect(JSON.parse(written)).toEqual({
      ...JSON.parse(held),
      mcpServers: {
        ...JSON.parse(held).mcpServers,
        foldcase: { command: "npx", args: ["foldcase", "mcp"] },
      },
    })
  })

  test("leaves a config that already names foldcase exactly as it found it", async () => {
    const held = JSON.stringify(
      { mcpServers: { foldcase: { command: "node", args: ["./local/foldcase.js", "mcp"] } } },
      undefined,
      4,
    )

    const { artifacts, held: written } = await wiring(write(".mcp.json", held), mcpJson)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      ".mcp.json",
      "kept",
    ])
    // Not re-encoded, not re-indented: an entry that is already there is a
    // decision the consumer made, down to the whitespace around it.
    expect(written).toBe(held)
  })

  test("points the server at src/ when the target has one, and omits env when it does not", async () => {
    const { held } = await wiring(makeDirectory("src"), mcpJson)

    expect(JSON.parse(held).mcpServers.foldcase.env).toEqual({ FOLDCASE_SHOWCASE_DIR: "src" })
    const { held: bare } = await wiring(nothing, mcpJson)
    expect(JSON.parse(bare).mcpServers.foldcase.env).toBeUndefined()
  })

  test("refuses a config it cannot read, and leaves every byte of it alone", async () => {
    const held = "{ not json at all"
    const { error, written } = await refusing(write(".mcp.json", held), mcpJson)

    expect(error).toBeInstanceOf(InitFileError)
    expect((error as InitFileError).message).toContain(".mcp.json")
    expect(written).toBe(held)
  })

  test("refuses a config whose mcpServers is not an object", async () => {
    const held = JSON.stringify({ mcpServers: ["foldcase"] })
    const { error, written } = await refusing(write(".mcp.json", held), mcpJson)

    expect((error as InitFileError).reason).toContain("`mcpServers` is not an object")
    expect(written).toBe(held)
  })
})

describe("initialize — AGENTS.md", () => {
  test("creates it holding the house rules when the directory has none", async () => {
    const { artifacts, held } = await wiring(nothing, agentsMd)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      "AGENTS.md",
      "created",
    ])
    expect(held).toBe(`${agentsSection}\n`)
    expect(held.startsWith("## Showcases (Foldcase)")).toBe(true)
  })

  test("appends the section to a file that has none, keeping what was there", async () => {
    const held = "# House rules\n\n- Run the tests.\n"
    const { artifacts, held: written } = await wiring(write("AGENTS.md", held), agentsMd)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      "AGENTS.md",
      "appended",
    ])
    // A blank line between what they wrote and what we added, and nothing of
    // theirs touched.
    expect(written).toBe(`# House rules\n\n- Run the tests.\n\n${agentsSection}\n`)
  })

  test("leaves a file that already carries the section exactly as it found it", async () => {
    const held = `# House rules\n\n${agentsSection}\n\n- And one of our own.\n`
    const { artifacts, held: written } = await wiring(write("AGENTS.md", held), agentsMd)

    expect(artifacts.map((artifact) => [artifact.file, artifact.action])).toContainEqual([
      "AGENTS.md",
      "kept",
    ])
    expect(written).toBe(held)
  })
})

describe("the section it writes", () => {
  test("is the block the README tells a reader to paste, word for word", async () => {
    // Two copies of house rules drift, and the drift is invisible: the README
    // is what a human pastes, `init` is what an agent gets. This is the seam
    // that keeps them one text.
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text()
    const fenced = readme.slice(readme.indexOf("### Paste into your"))
    const opening = "```markdown\n"
    const body = fenced.slice(fenced.indexOf(opening) + opening.length)

    expect(body.slice(0, body.indexOf("```")).trimEnd()).toBe(agentsSection)
  })
})

describe("initialize — a second run", () => {
  test("changes nothing, and says so for both files", async () => {
    const twice = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const dir = yield* fs.makeTempDirectoryScoped()
          const first = yield* initialize(dir)
          const after = {
            mcp: yield* fs.readFileString(`${dir}/.mcp.json`),
            agents: yield* fs.readFileString(`${dir}/AGENTS.md`),
          }
          const second = yield* initialize(dir)
          return {
            first: first.map((artifact) => artifact.action),
            second: second.map((artifact) => artifact.action),
            after,
            now: {
              mcp: yield* fs.readFileString(`${dir}/.mcp.json`),
              agents: yield* fs.readFileString(`${dir}/AGENTS.md`),
            },
          }
        }),
      ).pipe(Effect.provide(PlatformLive)),
    )

    expect(twice.first).toEqual(["created", "created"])
    expect(twice.second).toEqual(["kept", "kept"])
    expect(twice.now).toEqual(twice.after)
  })
})
