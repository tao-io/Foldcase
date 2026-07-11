import { describe, expect, it } from "vitest";
import { describeDispatchedMessage } from "../../src/foldkit/message-log.js";

describe("describeDispatchedMessage", () => {
  it("extracts the _tag and leaves an empty payload for a bare message", () => {
    expect(describeDispatchedMessage({ _tag: "ClickedIncrement" })).toEqual({
      tag: "ClickedIncrement",
      payload: {},
    });
  });

  it("keeps the remaining fields (without _tag) as the payload", () => {
    expect(describeDispatchedMessage({ _tag: "ChangedCount", count: 3, label: "x" })).toEqual({
      tag: "ChangedCount",
      payload: { count: 3, label: "x" },
    });
  });

  it("returns undefined when there is no string _tag", () => {
    expect(describeDispatchedMessage({ count: 1 })).toBeUndefined();
    expect(describeDispatchedMessage({ _tag: 42 })).toBeUndefined();
    expect(describeDispatchedMessage(null)).toBeUndefined();
    expect(describeDispatchedMessage("nope")).toBeUndefined();
    expect(describeDispatchedMessage([1, 2])).toBeUndefined();
  });
});
