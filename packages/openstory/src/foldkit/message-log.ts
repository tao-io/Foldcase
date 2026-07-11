import type { MessageLogEntryShape } from "../boot/protocol.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shape a Foldkit-dispatched message (`{ _tag, ...fields }`) into the shell's
 * message-log entry (tag + payload). Pure: the caller stamps `ts` at post time.
 * Returns `undefined` for anything without a string `_tag` so non-tagged
 * dispatch values are ignored rather than logged as noise.
 */
export const describeDispatchedMessage = (message: unknown): MessageLogEntryShape | undefined => {
  if (!isRecord(message)) return undefined;
  const tag = message["_tag"];
  if (typeof tag !== "string") return undefined;
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (key === "_tag") continue;
    payload[key] = value;
  }
  return { tag, payload };
};
