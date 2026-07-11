import { Cause, Effect, Exit, Fiber, Schema } from "effect";
import { OpenstoryAdapterMissingFrameworkError } from "../errors.js";
import type { OpenstoryRenderer, RendererMountOpts, RendererUpdateOpts } from "../types.js";

interface FoldkitProgramConfig {
  Model: unknown;
  init: (...args: unknown[]) => readonly [unknown, ReadonlyArray<unknown>];
  update: (model: unknown, message: unknown) => readonly [unknown, ReadonlyArray<unknown>];
  view: (model: unknown, viewInputs?: unknown) => unknown;
  subscriptions?: unknown;
  Flags?: unknown;
  flags?: unknown;
  routing?: unknown;
  resources?: unknown;
  managedResources?: unknown;
  devTools?: unknown;
  crash?: unknown;
  slowView?: unknown;
  freezeModel?: boolean;
}

interface FoldkitRuntimeModule {
  Runtime: {
    makeApplication: (config: FoldkitProgramConfig & { container: HTMLElement }) => {
      start: (hmrModel?: unknown) => Effect.Effect<void, unknown>;
    };
  };
  Html: {
    html: () => {
      submodel: (config: {
        slotId: string;
        model: unknown;
        view: (model: unknown, viewInputs?: unknown) => unknown;
        toParentMessage: (message: unknown) => unknown;
      }) => unknown;
    };
  };
}

interface FoldkitProgramFactory {
  (args: unknown, context: unknown): unknown;
}

interface FoldkitProgramContainer {
  program: FoldkitProgramConfig | FoldkitProgramFactory;
}

interface FoldkitMounted {
  container: HTMLElement;
  fiber: Fiber.Fiber<void, unknown> | undefined;
  runId: number;
  config: FoldkitProgramConfig | undefined;
  latestModel: unknown;
  hasLatestModel: boolean;
}

let cachedFoldkit: FoldkitRuntimeModule | undefined;

const ensureFoldkit = async (): Promise<FoldkitRuntimeModule> => {
  if (cachedFoldkit) return cachedFoldkit;
  try {
    const foldkitModule = (await import("foldkit")) as unknown as FoldkitRuntimeModule;
    cachedFoldkit = foldkitModule;
    return foldkitModule;
  } catch {
    throw new OpenstoryAdapterMissingFrameworkError("foldkit", "foldkit");
  }
};

const hasProgramFields = (value: unknown): value is FoldkitProgramConfig =>
  typeof value === "object" &&
  value !== null &&
  "Model" in value &&
  "init" in value &&
  "update" in value &&
  "view" in value;

const hasProgramProperty = (value: unknown): value is FoldkitProgramContainer =>
  typeof value === "object" && value !== null && "program" in value;

const resolveProgramConfig = (
  value: unknown,
  args: unknown,
  context: unknown,
): FoldkitProgramConfig => {
  if (hasProgramFields(value)) return value;
  if (typeof value === "function") return resolveProgramConfig(value(args, context), args, context);
  if (hasProgramProperty(value)) {
    const { program } = value;
    if (typeof program === "function")
      return resolveProgramConfig(program(args, context), args, context);
    if (hasProgramFields(program)) return program;
  }
  throw new OpenstoryAdapterMissingFrameworkError("foldkit", "foldkit");
};

const documentTitle = (context: { name: string; title: string }): string =>
  context.title ? `${context.name} - ${context.title}` : context.name;

const renderProgramBody = (
  foldkit: FoldkitRuntimeModule,
  config: FoldkitProgramConfig,
  model: unknown,
): unknown =>
  foldkit.Html.html().submodel({
    slotId: "openstory-story",
    model,
    view: config.view,
    toParentMessage: (message) => message,
  });

const createFoldkitHost = (): HTMLElement => {
  const host = document.createElement("div");
  host.id = "openstory-foldkit-root";
  return host;
};

const errorMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? (squashed.stack ?? squashed.message) : String(squashed);
};

const surfaceRuntimeFailure = (
  mounted: FoldkitMounted,
  currentRunId: number,
  cause: Cause.Cause<unknown>,
): void => {
  if (mounted.runId !== currentRunId) return;
  const message = errorMessage(cause);
  if (typeof console !== "undefined") {
    console.error("foldcase/foldkit: runtime crashed", message);
  }
  const element = document.createElement("pre");
  element.textContent = `foldcase/foldkit: runtime crashed\n\n${message}`;
  mounted.container.replaceChildren(element);
};

const surfaceMountFailure = (
  mounted: FoldkitMounted,
  currentRunId: number,
  cause: unknown,
): void => {
  if (mounted.runId !== currentRunId) return;
  const message = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  if (typeof console !== "undefined") {
    console.error("foldcase/foldkit: mount failed", message);
  }
  const element = document.createElement("pre");
  element.textContent = `foldcase/foldkit: mount failed\n\n${message}`;
  mounted.container.replaceChildren(element);
};

const encodeModelForRestore = (config: FoldkitProgramConfig, model: unknown): unknown => {
  const modelSchema = config.Model;
  if (!Schema.isSchema(modelSchema)) return model;
  const jsonCodec = Schema.toCodecJson(modelSchema as unknown as Schema.Codec<unknown>);
  try {
    return Schema.encodeUnknownSync(jsonCodec)(model);
  } catch {
    return model;
  }
};

const startMount = (
  mounted: FoldkitMounted,
  options: RendererMountOpts<unknown> | (RendererUpdateOpts<unknown> & { container: HTMLElement }),
  restore: { model: unknown } | undefined,
): void => {
  const nextRunId = mounted.runId + 1;
  void mountInto(mounted, options, restore).catch((cause) => {
    surfaceMountFailure(mounted, nextRunId, cause);
  });
};

const mountInto = async (
  mounted: FoldkitMounted,
  options: RendererMountOpts<unknown> | (RendererUpdateOpts<unknown> & { container: HTMLElement }),
  restore: { model: unknown } | undefined,
): Promise<void> => {
  mounted.runId += 1;
  const currentRunId = mounted.runId;
  interruptMountedFiber(mounted);
  const config = resolveProgramConfig(
    options.render(options.args, options.context),
    options.args,
    options.context,
  );
  mounted.config = config;
  const host = createFoldkitHost();
  options.container.replaceChildren(host);
  const foldkit = await ensureFoldkit();
  if (mounted.runId !== currentRunId) return;
  const program = foldkit.Runtime.makeApplication({
    ...config,
    container: host,
    view: (model) => {
      mounted.latestModel = model;
      mounted.hasLatestModel = true;
      return {
        title: documentTitle(options.context),
        body: renderProgramBody(foldkit, config, model),
      };
    },
  });
  const hmrModel = restore === undefined ? undefined : encodeModelForRestore(config, restore.model);
  mounted.fiber = Effect.runFork(program.start(hmrModel));
  mounted.fiber.addObserver((exit) => {
    if (Exit.isFailure(exit)) {
      surfaceRuntimeFailure(mounted, currentRunId, exit.cause);
    }
  });
};

const interruptMountedFiber = (mounted: FoldkitMounted): void => {
  if (mounted.fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(mounted.fiber));
    mounted.fiber = undefined;
  }
};

const defaultRender =
  (component: unknown) =>
  (_args: unknown, _context: unknown): unknown =>
    component;

export const renderer: OpenstoryRenderer<unknown, FoldkitMounted> = {
  defaultRender,
  mount: (options) => {
    const mounted: FoldkitMounted = {
      container: options.container,
      fiber: undefined,
      runId: 0,
      config: undefined,
      latestModel: undefined,
      hasLatestModel: false,
    };
    startMount(mounted, options, undefined);
    return mounted;
  },
  update: (mounted, options) => {
    const restore = mounted.hasLatestModel ? { model: mounted.latestModel } : undefined;
    startMount(mounted, { ...options, container: mounted.container }, restore);
  },
  unmount: (mounted) => {
    mounted.runId += 1;
    interruptMountedFiber(mounted);
    mounted.container.replaceChildren();
    mounted.hasLatestModel = false;
    mounted.latestModel = undefined;
  },
};
