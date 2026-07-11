import type { StepFunction } from "../types.js";
import { serializeError, type PlayStatus, type StoryToShell } from "./protocol.js";

type PlayStepMessage = Extract<StoryToShell, { type: "play-step" }>;

/** Prefix a step failure with the step name (mutates an `Error` cause in place). */
export const wrapStepError = (stepName: string, cause: unknown): unknown => {
  if (cause instanceof Error) {
    cause.message = `step "${stepName}" failed: ${cause.message}`;
  }
  return cause;
};

/**
 * Shape a single play step transition into the append-only `play-step` protocol
 * variant. Pure: the shell orders entries by `index` and upserts on `status`.
 * A `cause` is only serialized for a `failed` transition.
 */
export const makePlayStepMessage = (
  name: string,
  index: number,
  status: PlayStatus,
  cause?: unknown,
): PlayStepMessage => {
  if (status === "failed" && cause !== undefined) {
    return { type: "play-step", name, index, status, error: serializeError(cause) };
  }
  return { type: "play-step", name, index, status };
};

/**
 * Build a `step()` that instruments each play step: it posts `running` before
 * the body, `passed` after it settles, or `failed` (with the serialized, wrapped
 * cause) before rethrowing. Indices are assigned monotonically in call order so
 * the shell can render an ordered, per-step status list — framework-agnostic,
 * needing no DevTools bridge. The rethrow preserves the existing wrapped-error
 * contract so `play-status` still reports the wrapped failure.
 */
export const createInstrumentedStep = (post: (message: PlayStepMessage) => void): StepFunction => {
  let nextIndex = 0;
  return async (name, body) => {
    const index = nextIndex;
    nextIndex += 1;
    post(makePlayStepMessage(name, index, "running"));
    try {
      await body();
    } catch (cause) {
      const wrapped = wrapStepError(name, cause);
      post(makePlayStepMessage(name, index, "failed", wrapped));
      throw wrapped;
    }
    post(makePlayStepMessage(name, index, "passed"));
  };
};
