import type * as Config from "effect/Config"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import type * as Path from "effect/Path"
import type * as Stdio from "effect/Stdio"
import { McpServer } from "effect/unstable/ai"
import type { ChildProcessSpawner } from "effect/unstable/process"

import { type CatalogDirectoryError, FoldcaseCatalog } from "./catalog.js"
import { FoldcaseHandlers, FoldcaseToolkit } from "./tools.js"

const SERVER_NAME = "foldcase-mcp"
const SERVER_VERSION = "0.1.0"

/**
 * The `foldcase mcp` catalog server as a launchable Layer, over stdio.
 *
 * Runtime-agnostic: the FileSystem, Path and Stdio implementations come from
 * the context, so the same Layer launches under Bun and under Node. Only the
 * shells (`src/main.ts`, `src/main.bun.ts`) name a runtime.
 *
 * Registers the {@link FoldcaseToolkit} verbs — list, get-schema,
 * get-model-schema, run, run-catalog, load — against the
 * {@link FoldcaseCatalog} first read from `FOLDCASE_SHOWCASE_DIR`, and runs the
 * MCP protocol over stdio (NDJSON-RPC). Logs are pinned to stderr because stdout
 * carries the protocol — any stray stdout write would corrupt the stream.
 *
 * This is the *catalog* half of the Foldcase agent loop; it composes with the
 * runtime `@foldkit/devtools-mcp` (dispatch_message / get_model / replay). The
 * catalog says which Showcases exist, exposes their Message and Model JSON
 * Schema, runs one play or all of them to a typed pass/fail, and re-reads
 * itself on demand; devtools-mcp drives the live app.
 */
export const makeFoldcaseMcpServer = <E, R>(
  catalog: Layer.Layer<FoldcaseCatalog, E, R>,
): Layer.Layer<never, E, R | Stdio.Stdio> =>
  McpServer.toolkit(FoldcaseToolkit).pipe(
    Layer.provide(FoldcaseHandlers),
    Layer.provide(McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION })),
    // The catalog is provided to the *whole* graph above, including the stdio
    // transport, so it is built first. That ordering is the tool-discovery
    // contract: `McpServer.layerStdio` forks a reader over stdin the moment it
    // is built, and the toolkit only registers its verbs once everything it
    // depends on exists. With the catalog inside that subgraph, a host that
    // wrote `initialize` and `tools/list` back to back was answered from an
    // empty registry while the directory walk and the `import()` of every
    // `*.showcase.ts` were still running — `{"tools":[]}`, permanently, for a
    // host that discovers once at startup. Loading the catalog before the
    // transport exists leaves no I/O between the reader starting and the verbs
    // being registered.
    Layer.provide(catalog),
    Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
  )

/**
 * The live server: the catalog is discovered from `FOLDCASE_SHOWCASE_DIR`.
 *
 * It asks for a `ChildProcessSpawner` on top of the reading services, because a
 * run leaves the process: the catalog spawns a child of the current runtime so
 * the play that runs is the one on disk (ADR-0001 › Amendment 4). Both shells
 * already provide it — it is part of `NodeServices` and of `BunServices`.
 */
export const FoldcaseMcpServer: Layer.Layer<
  never,
  CatalogDirectoryError | Config.ConfigError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Stdio.Stdio
> = makeFoldcaseMcpServer(FoldcaseCatalog.layer)
