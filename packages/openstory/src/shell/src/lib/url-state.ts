import { STORY_PATH_PREFIX } from "./constants";

export interface ShellUrlState {
  storyId?: string;
  args: Record<string, unknown>;
  globals: Record<string, unknown>;
}

const KEY_VALUE_SEPARATOR = ":";
const PAIR_SEPARATOR = ";";

const coerce = (raw: string): unknown => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

const parseKeyValueList = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  const result: Record<string, unknown> = {};
  for (const pair of raw.split(PAIR_SEPARATOR)) {
    const separatorIndex = pair.indexOf(KEY_VALUE_SEPARATOR);
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex);
    if (!key) continue;
    result[key] = coerce(decodeURIComponent(pair.slice(separatorIndex + 1)));
  }
  return result;
};

const stringifyKeyValueList = (record: Record<string, unknown>): string =>
  Object.entries(record)
    .map(([key, value]) => `${key}${KEY_VALUE_SEPARATOR}${encodeURIComponent(String(value))}`)
    .join(PAIR_SEPARATOR);

export const readUrlState = (): ShellUrlState => {
  const search = new URLSearchParams(window.location.search);
  const storyId = search.get("id") ?? undefined;
  return {
    storyId,
    args: parseKeyValueList(search.get("args")),
    globals: parseKeyValueList(search.get("globals")),
  };
};

export const writeUrlState = (state: ShellUrlState): void => {
  const search = new URLSearchParams();
  if (state.storyId) search.set("id", state.storyId);
  if (Object.keys(state.args).length > 0) search.set("args", stringifyKeyValueList(state.args));
  if (Object.keys(state.globals).length > 0) {
    search.set("globals", stringifyKeyValueList(state.globals));
  }
  const queryString = search.toString();
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
};

export const buildStoryIframeUrl = (state: ShellUrlState): string => {
  const search = new URLSearchParams();
  if (Object.keys(state.args).length > 0) search.set("args", stringifyKeyValueList(state.args));
  if (Object.keys(state.globals).length > 0) {
    search.set("globals", stringifyKeyValueList(state.globals));
  }
  search.set("a11y", "1");
  const queryString = search.toString();
  return `${STORY_PATH_PREFIX}${encodeURIComponent(state.storyId ?? "")}${queryString ? `?${queryString}` : ""}`;
};
