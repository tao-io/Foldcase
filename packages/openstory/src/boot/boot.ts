import {
  OPENSTORY_ROOT_ELEMENT_ID,
  PARENT_MESSAGE_SOURCE,
  SHELL_MESSAGE_SOURCE,
  URL_KV_KEY_VALUE_SEPARATOR,
  URL_KV_PAIR_SEPARATOR,
} from "../constants.js";
import type {
  ArgTypes,
  BeforeEachCleanup,
  BeforeEachFunction,
  Decorator,
  OpenstoryRenderer,
  PlayFunction,
  Preview,
  StoryContext,
  StoryParameters,
} from "../types.js";
import { escapeHtml } from "../utils/escape-html.js";
import { serializeError, type ShellToStory, type StoryToShell } from "./protocol.js";

export interface BootOptions {
  id: string;
  exportName: string;
  renderer: OpenstoryRenderer<unknown, unknown>;
  preview: Preview | undefined;
  storyModule: Record<string, unknown>;
}

interface UrlState {
  args: Record<string, unknown>;
  globals: Record<string, unknown>;
}

interface BuildContextOptions {
  id: string;
  exportName: string;
  meta: Record<string, unknown>;
  story: Record<string, unknown>;
  container: HTMLElement;
  args: Record<string, unknown>;
  parameters: StoryParameters;
  globals: Record<string, unknown>;
  abortSignal: AbortSignal;
}

interface RenderFunction {
  (args: unknown, context: StoryContext): unknown;
}

const readRecord = (
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined => {
  const value = source[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
};

const readDecorators = (source: Record<string, unknown> | undefined): Decorator[] => {
  const value = source?.["decorators"];
  return Array.isArray(value) ? (value as Decorator[]) : [];
};

const readString = (source: Record<string, unknown>, key: string): string | undefined => {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
};

const readFunction = <TFunction extends (...args: never[]) => unknown>(
  source: Record<string, unknown>,
  key: string,
): TFunction | undefined => {
  const value = source[key];
  return typeof value === "function" ? (value as TFunction) : undefined;
};

const composeDecorators = (
  decorators: Decorator[],
  innerRender: RenderFunction,
): RenderFunction => {
  if (decorators.length === 0) return innerRender;
  return decorators.reduceRight<RenderFunction>(
    (nextRender, decorator) => (args, context) =>
      decorator(() => nextRender(args, context), context),
    innerRender,
  );
};

const pickRenderFunction = (
  story: Record<string, unknown>,
  meta: Record<string, unknown>,
  renderer: OpenstoryRenderer<unknown, unknown>,
): RenderFunction => {
  const storyRender = readFunction<RenderFunction>(story, "render");
  if (storyRender) return storyRender;
  const metaRender = readFunction<RenderFunction>(meta, "render");
  if (metaRender) return metaRender;
  const component = meta["component"];
  if (component !== undefined && component !== null && renderer.defaultRender) {
    return renderer.defaultRender(component) as RenderFunction;
  }
  return () => component ?? null;
};

const coerceUrlValue = (rawValue: string): unknown => {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null") return null;
  if (rawValue === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) return Number(rawValue);
  return rawValue;
};

const parseKeyValueList = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  const result: Record<string, unknown> = {};
  for (const pair of raw.split(URL_KV_PAIR_SEPARATOR)) {
    const separatorIndex = pair.indexOf(URL_KV_KEY_VALUE_SEPARATOR);
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex);
    if (key === "") continue;
    const rawValue = pair.slice(separatorIndex + 1);
    result[key] = coerceUrlValue(decodeURIComponent(rawValue));
  }
  return result;
};

const parseUrlState = (search: string): UrlState => {
  const params = new URLSearchParams(search);
  return {
    args: parseKeyValueList(params.get("args")),
    globals: parseKeyValueList(params.get("globals")),
  };
};

const wrapStepError = (stepName: string, cause: unknown): unknown => {
  if (cause instanceof Error) {
    cause.message = `step "${stepName}" failed: ${cause.message}`;
  }
  return cause;
};

const buildStoryContext = (options: BuildContextOptions): StoryContext => {
  const title = readString(options.meta, "title") ?? "";
  const name = readString(options.story, "name") ?? options.exportName;
  const argTypes = (readRecord(options.meta, "argTypes") ?? {}) as ArgTypes;

  return {
    id: options.id,
    name,
    title,
    args: options.args,
    argTypes,
    globals: options.globals,
    parameters: options.parameters,
    canvasElement: options.container,
    abortSignal: options.abortSignal,
    step: async (stepName, body) => {
      try {
        await body();
      } catch (cause) {
        throw wrapStepError(stepName, cause);
      }
    },
    hooks: {},
  };
};

const sendToShell = (message: StoryToShell): void => {
  if (typeof window === "undefined" || !window.parent) return;
  try {
    window.parent.postMessage(
      { source: PARENT_MESSAGE_SOURCE, ...message },
      window.location.origin,
    );
  } catch {
    /* parent may be cross-origin when opened standalone */
  }
};

const surfaceFatalMessage = (message: string): void => {
  const node = document.getElementById(OPENSTORY_ROOT_ELEMENT_ID) ?? document.body;
  const pre = document.createElement("pre");
  pre.style.cssText =
    "color:#c00;padding:16px;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;";
  pre.textContent = message;
  node.appendChild(pre);
};

export const surfaceModuleLoadError = (storyId: string, error: unknown): void => {
  const message =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  surfaceFatalMessage(`openstory: story "${escapeHtml(storyId)}" failed to load.\n\n${message}`);
};

export const boot = (options: BootOptions): void => {
  const container = document.getElementById(OPENSTORY_ROOT_ELEMENT_ID);
  if (!container) {
    surfaceFatalMessage(`openstory: #${OPENSTORY_ROOT_ELEMENT_ID} not found in iframe document.`);
    return;
  }

  const meta = readRecord(options.storyModule, "default") ?? {};
  const story = readRecord(options.storyModule, options.exportName);
  if (!story) {
    surfaceFatalMessage(
      `openstory: story "${escapeHtml(options.exportName)}" not found in module.`,
    );
    return;
  }

  const initialUrlState = parseUrlState(window.location.search);

  const metaArgs = readRecord(meta, "args") ?? {};
  const storyArgs = readRecord(story, "args") ?? {};
  let args: Record<string, unknown> = {
    ...metaArgs,
    ...storyArgs,
    ...initialUrlState.args,
  };

  let globals: Record<string, unknown> = {
    ...(options.preview?.initialGlobals ?? {}),
    ...initialUrlState.globals,
  };

  const parameters: StoryParameters = {
    ...(options.preview?.parameters ?? {}),
    ...(readRecord(meta, "parameters") ?? {}),
    ...(readRecord(story, "parameters") ?? {}),
  };

  const composedDecorators = composeDecorators(
    [...(options.preview?.decorators ?? []), ...readDecorators(meta), ...readDecorators(story)],
    pickRenderFunction(story, meta, options.renderer),
  );

  const beforeEach =
    readFunction<BeforeEachFunction>(story, "beforeEach") ??
    readFunction<BeforeEachFunction>(meta, "beforeEach");

  const play =
    readFunction<PlayFunction>(story, "play") ?? readFunction<PlayFunction>(meta, "play");

  sendToShell({
    type: "ready",
    id: options.id,
    argTypes: (readRecord(meta, "argTypes") ?? {}) as Record<string, unknown>,
    parameters,
  });

  let abortController = new AbortController();
  let cleanupBeforeEach: BeforeEachCleanup | undefined;
  let mountedHandle: unknown;

  const teardown = async (): Promise<void> => {
    abortController.abort();
    abortController = new AbortController();
    try {
      await cleanupBeforeEach?.();
    } catch (cause) {
      sendToShell({ type: "error", phase: "before-each", error: serializeError(cause) });
    }
    cleanupBeforeEach = undefined;
    if (mountedHandle !== undefined) {
      try {
        options.renderer.unmount(mountedHandle);
      } catch {
        /* best effort */
      }
      mountedHandle = undefined;
    }
  };

  const buildCurrentContext = (): StoryContext =>
    buildStoryContext({
      id: options.id,
      exportName: options.exportName,
      meta,
      story,
      container,
      args,
      parameters,
      globals,
      abortSignal: abortController.signal,
    });

  const mountOnce = async (): Promise<void> => {
    await teardown();

    const context = buildCurrentContext();

    if (beforeEach) {
      try {
        const result = await beforeEach(context);
        if (typeof result === "function") cleanupBeforeEach = result;
      } catch (cause) {
        sendToShell({ type: "error", phase: "before-each", error: serializeError(cause) });
        return;
      }
    }

    const mountStartTime = performance.now();
    try {
      mountedHandle = options.renderer.mount({
        container,
        render: composedDecorators,
        args,
        context,
      });
    } catch (cause) {
      sendToShell({ type: "error", phase: "mount", error: serializeError(cause) });
      surfaceFatalMessage(
        `openstory: mount error\n${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
      );
      return;
    }
    sendToShell({
      type: "rendered",
      id: options.id,
      durationMs: performance.now() - mountStartTime,
    });

    const modelSchema = options.renderer.describeModel?.(mountedHandle);
    if (modelSchema !== undefined) {
      sendToShell({ type: "model-schema", id: options.id, schema: modelSchema });
    }

    if (play) {
      sendToShell({ type: "play-status", status: "running" });
      try {
        await play(context);
        sendToShell({ type: "play-status", status: "passed" });
      } catch (cause) {
        sendToShell({ type: "play-status", status: "failed", error: serializeError(cause) });
      }
    }
  };

  const handleShellMessage = async (message: ShellToStory): Promise<void> => {
    switch (message.type) {
      case "set-args": {
        args = { ...args, ...message.args };
        if (mountedHandle !== undefined) {
          try {
            const context = buildCurrentContext();
            const updateStartTime = performance.now();
            options.renderer.update(mountedHandle, {
              render: composedDecorators,
              args,
              context,
            });
            sendToShell({ type: "args-changed", args });
            sendToShell({
              type: "rendered",
              id: options.id,
              durationMs: performance.now() - updateStartTime,
            });
            return;
          } catch {
            /* fall through to full remount */
          }
        }
        await mountOnce();
        break;
      }
      case "set-globals": {
        globals = { ...globals, ...message.globals };
        await mountOnce();
        break;
      }
      case "set-model": {
        if (mountedHandle !== undefined) {
          options.renderer.setModel?.(mountedHandle, {
            path: message.path,
            value: message.value,
          });
        }
        break;
      }
      case "rerun-play": {
        if (!play) return;
        sendToShell({ type: "play-status", status: "running" });
        try {
          await play(buildCurrentContext());
          sendToShell({ type: "play-status", status: "passed" });
        } catch (cause) {
          sendToShell({
            type: "play-status",
            status: "failed",
            error: serializeError(cause),
          });
        }
        break;
      }
      case "reload": {
        window.location.reload();
        break;
      }
    }
  };

  void mountOnce();

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as { source?: string } & ShellToStory;
    if (!data || data.source !== SHELL_MESSAGE_SOURCE) return;
    void handleShellMessage(data);
  });
};
