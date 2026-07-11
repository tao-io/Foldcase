export const setAtPath = (
  target: unknown,
  path: ReadonlyArray<string>,
  value: unknown,
): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const base =
    typeof target === "object" && target !== null && !Array.isArray(target)
      ? (target as Record<string, unknown>)
      : {};
  return { ...base, [head]: setAtPath(base[head], rest, value) };
};
