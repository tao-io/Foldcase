import type * as Config from "effect/Config"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import type * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import type * as Stdio from "effect/Stdio"
import { McpServer } from "effect/unstable/ai"

import { FoldcaseCatalog } from "./catalog.js"
import type { ShowcaseModuleError } from "../cli.js"
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
 * Registers the {@link FoldcaseToolkit} verbs (list / get-schema / run) against
 * the {@link FoldcaseCatalog} loaded from `FOLDCASE_SHOWCASE_DIR`, and runs the
 * MCP protocol over stdio (NDJSON-RPC). Logs are pinned to stderr because stdout
 * carries the protocol — any stray stdout write would corrupt the stream.
 *
 * This is the *catalog* half of the Foldcase agent loop; it composes with the
 * runtime `@foldkit/devtools-mcp` (dispatch_message / get_model / replay). The
 * catalog says which Showcases exist, exposes their Message JSON Schema, and
 * runs a Showcase's play to a typed pass/fail; devtools-mcp drives the live app.
 */
export const FoldcaseMcpServer: Layer.Layer<
  never,
  ShowcaseModuleError | PlatformError | Config.ConfigError,
  FileSystem.FileSystem | Path.Path | Stdio.Stdio
> = McpServer.toolkit(FoldcaseToolkit).pipe(
  Layer.provideMerge(FoldcaseHandlers),
  Layer.provide(FoldcaseCatalog.layer),
  Layer.provide(McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION })),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
)
