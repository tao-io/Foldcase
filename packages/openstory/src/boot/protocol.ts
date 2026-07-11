export type PlayStatus = "running" | "passed" | "failed";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  docsUrl?: string;
}

export type ShellToStory =
  | { type: "set-args"; args: Record<string, unknown> }
  | { type: "set-globals"; globals: Record<string, unknown> }
  | { type: "set-model"; path: ReadonlyArray<string>; value: unknown }
  | { type: "rerun-play" }
  | { type: "reload" };

export type StoryToShell =
  | {
      type: "ready";
      id: string;
      argTypes: Record<string, unknown>;
      parameters: Record<string, unknown>;
    }
  | { type: "rendered"; id: string; durationMs: number }
  | { type: "args-changed"; args: Record<string, unknown> }
  | { type: "model-schema"; id: string; schema: Record<string, unknown> }
  | { type: "play-status"; status: PlayStatus; error?: SerializedError }
  | {
      type: "console";
      level: "log" | "warn" | "error" | "info" | "debug";
      args: unknown[];
      ts: number;
    }
  | {
      type: "error";
      phase: "mount" | "render" | "play" | "before-each";
      error: SerializedError;
    };

const readStringProperty = (value: object, propertyName: string): string | undefined => {
  const candidate = (value as Record<string, unknown>)[propertyName];
  return typeof candidate === "string" ? candidate : undefined;
};

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: readStringProperty(error, "code"),
      docsUrl: readStringProperty(error, "docsUrl"),
    };
  }
  return { name: "Error", message: String(error) };
};
