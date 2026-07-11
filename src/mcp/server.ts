import { BunFileSystem, BunPath, BunStdio } from "@effect/platform-bun"
import type * as Config from "effect/Config"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import type { PlatformError } from "effect/PlatformError"
import { McpServer } from "effect/unstable/ai"

import { FoldcaseCatalog } from "./catalog"
import type { ShowcaseModuleError } from "../cli"
import { FoldcaseHandlers, FoldcaseToolkit } from "./tools"

const SERVER_NAME = "foldcase-mcp"
const SERVER_VERSION = "0.1.0"

/**
 * The `foldcase mcp` catalog server as a launchable Layer, over stdio.
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
  ShowcaseModuleError | PlatformError | Config.ConfigError
> = McpServer.toolkit(FoldcaseToolkit).pipe(
  Layer.provideMerge(FoldcaseHandlers),
  Layer.provide(FoldcaseCatalog.layer),
  Layer.provide(McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION })),
  Layer.provide(BunStdio.layer),
  Layer.provide(BunFileSystem.layer),
  Layer.provide(BunPath.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
)
