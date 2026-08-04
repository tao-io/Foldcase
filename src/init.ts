// `foldcase init` — wire a consumer's repository for its agent.
//
// Two files, and nothing else: `.mcp.json`, so the host launches the catalog
// server, and `AGENTS.md`, so the agent knows what a Showcase is before it
// calls a tool. Both are *merged*: an entry that is already there is left
// exactly as it is, so a second run changes nothing and says so. A tool that
// rewrites a config it did not write is a tool nobody runs twice.

import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as P from "effect/Predicate"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaTransformation from "effect/SchemaTransformation"

/** The MCP host config this writes into, and the key it claims inside it. */
const MCP_FILE = ".mcp.json"
const SERVERS_KEY = "mcpServers"
const SERVER_KEY = "foldcase"

/**
 * What one run did to one file: the name a reader knows it by, the path it was
 * written at, and which of the four things happened to it.
 *
 * `created` and `kept` mean the same for both files. `updated` is a `.mcp.json`
 * that had servers of its own and now has one more; `appended` is an
 * `AGENTS.md` that gained a section at its end. Nothing here overwrites, so no
 * action says it did.
 */
export class InitArtifact extends Schema.Class<InitArtifact>("foldcase/InitArtifact")({
  file: Schema.String,
  path: Schema.String,
  action: Schema.Literals(["created", "updated", "appended", "kept"]),
}) {}

/**
 * A file `init` was asked to wire and could not read as what it claims to be —
 * a `.mcp.json` that is not JSON, say. Refusing is the whole point: the
 * alternative is overwriting a config the user wrote by hand.
 */
export class InitFileError extends Schema.TaggedErrorClass<InitFileError>()(
  "foldcase/InitFileError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {
  /**
   * A schema-backed error carries its payload in fields, so its inherited
   * `Error.message` is empty. Render the payload, the way the loader's own
   * error does, so a runtime printing an unhandled failure names the file.
   */
  override get message(): string {
    return `${this.path}: ${this.reason}`
  }
}

/**
 * A JSON object, decoded without knowing a single one of its keys. That is the
 * point: `.mcp.json` belongs to the consumer, and every server, comment-key and
 * setting in it that is not ours has to survive the merge untouched. Values
 * stay `Unknown`, so they are carried through the decode and back out again as
 * they came.
 */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown)

/**
 * The config as it sits on disk: JSON text, decoded to that object and encoded
 * back with two-space indentation, because a human edits this file after us.
 * One codec both ways, so what is written is what was read.
 */
/**
 * `Schema.fromJsonString`, but the text it encodes to is indented. Same shape
 * as the library's own — a JSON parse on the way in, a stringify on the way out
 * — with the two spaces a config file a human opens has to have.
 */
const fromIndentedJsonString = <S extends Schema.Constraint>(schema: S) =>
  Schema.String.pipe(
    Schema.decodeTo(
      schema,
      new SchemaTransformation.Transformation<unknown, string>(
        SchemaGetter.parseJson(),
        SchemaGetter.stringifyJson({ space: 2 }),
      ),
    ),
  )

const McpConfig = fromIndentedJsonString(JsonObject)

const decodeConfig = Schema.decodeEffect(McpConfig)
const encodeConfig = Schema.encodeEffect(McpConfig)

/** The server entry `.mcp.json` gets, in the shape the README documents. */
interface ServerEntry {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
}

const isDirectory = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(path))) {
      return false
    }
    return (yield* fs.stat(path)).type === "Directory"
  })

/**
 * A Bun project, by its lockfile. Both names count: `bun.lockb` is what Bun
 * wrote before 1.2, and a repository that still carries one is still a Bun
 * repository.
 */
const BUN_LOCKFILES = ["bun.lock", "bun.lockb"]

/** The directory a Foldkit app keeps its source — and its Showcases — in. */
const SHOWCASE_DIR = "src"

/**
 * The entry to write. The runtime is read off the *target's* lockfile, not off
 * the bin that happens to be running this: the host will launch whatever that
 * repository installs, so a Bun project gets `bunx foldcase-bun` and everything
 * else `npx foldcase`. `env` is set only when there is a `src/` to point at —
 * naming a directory that is not there would send the server looking for a
 * catalog nobody has.
 */
const serverEntry = Effect.fn("foldcase.init.serverEntry")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const lockfiles = yield* Effect.forEach(BUN_LOCKFILES, (name) =>
    fs.exists(path.join(dir, name)),
  )
  const bun = lockfiles.includes(true)
  const runtime = bun
    ? { command: "bunx", args: ["foldcase-bun", "mcp"] }
    : { command: "npx", args: ["foldcase", "mcp"] }
  const showcases = yield* isDirectory(path.join(dir, SHOWCASE_DIR))
  return (
    showcases ? { ...runtime, env: { FOLDCASE_SHOWCASE_DIR: SHOWCASE_DIR } } : runtime
  ) satisfies ServerEntry
})

const writeConfig = Effect.fn("foldcase.init.writeConfig")(function* (
  file: string,
  config: { readonly [key: string]: unknown },
) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* Effect.orDie(encodeConfig(config))
  yield* fs.writeFileString(file, `${text}\n`)
})

/**
 * The `mcpServers` block of a config already on disk. A file without one is
 * wired the same way an empty one is; a file whose `mcpServers` is not an
 * object is refused, because merging into it would mean deciding what the
 * consumer meant by it.
 */
const serversOf = (
  file: string,
  config: { readonly [key: string]: unknown },
): Effect.Effect<{ readonly [key: string]: unknown }, InitFileError> => {
  const servers = config[SERVERS_KEY]
  if (servers === undefined) {
    return Effect.succeed({})
  }
  return P.isObject(servers)
    ? Effect.succeed(servers)
    : Effect.fail(new InitFileError({ path: file, reason: `\`${SERVERS_KEY}\` is not an object` }))
}

// The file is JSON the consumer owns, so a parse failure is a refusal with the
// reason attached — never a rewrite of what could not be read. `decodeConfig`
// fails a `ParseError`, which says the same thing in a shape only Effect reads;
// this is the one place it is normalised, and it is normalised once.
const readConfig = Effect.fn("foldcase.init.readConfig")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file)
  return yield* Effect.mapError(
    decodeConfig(text),
    (cause) => new InitFileError({ path: file, reason: `not readable as JSON — ${cause.message}` }),
  )
})

const wireMcpJson = Effect.fn("foldcase.init.mcpJson")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(dir, MCP_FILE)
  const at = { file: MCP_FILE, path: file }
  if (!(yield* fs.exists(file))) {
    yield* writeConfig(file, { [SERVERS_KEY]: { [SERVER_KEY]: yield* serverEntry(dir) } })
    return new InitArtifact({ ...at, action: "created" })
  }
  const config = yield* readConfig(file)
  const servers = yield* serversOf(file, config)
  // An entry that is already there is the consumer's decision, whatever it
  // says. Not touching the file at all is the only way to keep it — a re-encode
  // would reformat what we were asked to leave alone.
  if (servers[SERVER_KEY] !== undefined) {
    return new InitArtifact({ ...at, action: "kept" })
  }
  yield* writeConfig(file, {
    ...config,
    [SERVERS_KEY]: { ...servers, [SERVER_KEY]: yield* serverEntry(dir) },
  })
  return new InitArtifact({ ...at, action: "updated" })
})

/** The agent instructions file, and the heading this tool claims inside it. */
const AGENTS_FILE = "AGENTS.md"
const AGENTS_HEADING = "## Showcases (Foldcase)"

/**
 * The section `init` writes into a consumer's `AGENTS.md`: the same paragraph
 * the README tells a reader to paste, so the two say one thing. It is prose for
 * an agent, not a description of the record — the record is declared once, in
 * `src/runner.ts`, and this points at the tools that serve it rather than
 * restating what they answer.
 *
 * Written as lines joined at the end, because the text is Markdown full of
 * backticks and a template literal would have to escape every one of them.
 */
export const agentsSection = [
  AGENTS_HEADING,
  "",
  "- Components are described by Showcases: `export const showcases: ReadonlyArray<Showcase>`",
  "  in `*.showcase.ts` files. The record is `{ id, play, message?, model? }`; an id is",
  "  `component/state`.",
  "- To learn a component, use the `foldcase_*` MCP tools or `npx foldcase test --json` —",
  "  do not parse `*.showcase.ts` files or crawl the source for the same facts.",
  "- When you add a component state, add a Showcase for it. When you change a Message or",
  "  Model Schema, regenerate the tables: `npx foldcase docs src docs/schemas`.",
  "- `foldcase_load_catalog` sees files that appeared or vanished, not edits inside a file",
  "  that already loaded. After such an edit, verify with `npx foldcase test` instead.",
  "- Exit 1 means a failed Showcase, an unloadable file, or an empty catalog. All three are",
  "  reported as data; one bad file never hides the rest.",
].join("\n")

const wireAgentsMd = Effect.fn("foldcase.init.agentsMd")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(dir, AGENTS_FILE)
  const at = { file: AGENTS_FILE, path: file }
  if (!(yield* fs.exists(file))) {
    yield* fs.writeFileString(file, `${agentsSection}\n`)
    return new InitArtifact({ ...at, action: "created" })
  }
  const held = yield* fs.readFileString(file)
  // The heading is the claim: a file that carries it has been wired, whatever
  // the consumer has since done to the words under it.
  if (held.includes(AGENTS_HEADING)) {
    return new InitArtifact({ ...at, action: "kept" })
  }
  // Their file, their order: the section goes at the end, one blank line after
  // whatever they had. A file that is empty gets the section alone rather than
  // a blank line to open on.
  const before = held.trimEnd()
  yield* fs.writeFileString(
    file,
    before === "" ? `${agentsSection}\n` : `${before}\n\n${agentsSection}\n`,
  )
  return new InitArtifact({ ...at, action: "appended" })
})

/**
 * Wire `target` for an agent, returning what happened to each file. The
 * directory has to exist — a target that does not is a typed failure, as it is
 * for every other subcommand.
 */
export const initialize = Effect.fn("foldcase.init.initialize")(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.resolve(target)
  yield* fs.stat(dir)
  return [yield* wireMcpJson(dir), yield* wireAgentsMd(dir)] as ReadonlyArray<InitArtifact>
})
