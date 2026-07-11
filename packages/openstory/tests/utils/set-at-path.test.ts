import { describe, expect, it } from "vitest";
import { setAtPath } from "../../src/utils/set-at-path.js";

describe("setAtPath", () => {
  it("sets a top-level field immutably", () => {
    const model = { label: "a", count: 1 };
    const next = setAtPath(model, ["count"], 5);
    expect(next).toEqual({ label: "a", count: 5 });
    expect(model).toEqual({ label: "a", count: 1 });
  });

  it("sets a nested field without mutating siblings", () => {
    const model = { outer: { inner: 1, keep: 2 }, other: 3 };
    const next = setAtPath(model, ["outer", "inner"], 9);
    expect(next).toEqual({ outer: { inner: 9, keep: 2 }, other: 3 });
    expect(model.outer.inner).toBe(1);
  });

  it("replaces the whole target when the path is empty", () => {
    expect(setAtPath({ a: 1 }, [], "replaced")).toBe("replaced");
  });
});
