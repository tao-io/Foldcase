import { useEffect, useState, type RefObject } from "react";
import { PARENT_MESSAGE_SOURCE, SHELL_MESSAGE_SOURCE } from "@/lib/constants";
import type { A11yViolation, PlayStatus, StoryStatus } from "@/lib/types";

interface IframeIncomingMessage {
  source?: string;
  type?:
    | "ready"
    | "rendered"
    | "args-changed"
    | "play-status"
    | "console"
    | "error"
    | "model-schema"
    | "a11y";
  status?: PlayStatus;
  error?: { name: string; message: string };
  id?: string;
  args?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  violations?: A11yViolation[];
}

export interface IframeCommsApi {
  status: StoryStatus;
  modelSchema: Record<string, unknown> | undefined;
  a11yViolations: A11yViolation[];
  setArgs: (args: Record<string, unknown>) => void;
  setGlobals: (globals: Record<string, unknown>) => void;
  setModel: (path: ReadonlyArray<string>, value: unknown) => void;
  rerunPlay: () => void;
  reload: () => void;
}

export const useIframeComms = (
  iframeRef: RefObject<HTMLIFrameElement | null>,
  storyId: string | undefined,
): IframeCommsApi => {
  const [status, setStatus] = useState<StoryStatus>({ rendered: false });
  const [modelSchema, setModelSchema] = useState<Record<string, unknown> | undefined>(undefined);
  const [a11yViolations, setA11yViolations] = useState<A11yViolation[]>([]);

  useEffect(() => {
    setStatus({ rendered: false });
    setModelSchema(undefined);
    setA11yViolations([]);
  }, [storyId]);

  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent<IframeIncomingMessage>): void => {
      const data = event.data;
      if (!data || data.source !== PARENT_MESSAGE_SOURCE) return;
      if (data.type === "rendered") {
        setStatus((previous) => ({ ...previous, rendered: true, error: undefined }));
        return;
      }
      if (data.type === "model-schema" && data.schema) {
        setModelSchema(data.schema);
        return;
      }
      if (data.type === "a11y" && data.violations) {
        setA11yViolations(data.violations);
        return;
      }
      if (data.type === "play-status" && data.status) {
        setStatus((previous) => ({
          ...previous,
          playStatus: data.status,
          error: data.error?.message,
        }));
        return;
      }
      if (data.type === "error" && data.error) {
        setStatus((previous) => ({ ...previous, error: data.error?.message }));
      }
    };

    window.addEventListener("message", handleIframeMessage);
    return () => window.removeEventListener("message", handleIframeMessage);
  }, []);

  const postToStory = (payload: Record<string, unknown>): void => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { source: SHELL_MESSAGE_SOURCE, ...payload },
      window.location.origin,
    );
  };

  return {
    status,
    modelSchema,
    a11yViolations,
    setArgs: (args) => postToStory({ type: "set-args", args }),
    setGlobals: (globals) => postToStory({ type: "set-globals", globals }),
    setModel: (path, value) => postToStory({ type: "set-model", path, value }),
    rerunPlay: () => postToStory({ type: "rerun-play" }),
    reload: () => postToStory({ type: "reload" }),
  };
};
