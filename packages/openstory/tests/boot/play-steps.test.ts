import { describe, expect, it } from "vitest";
import type { StoryToShell } from "../../src/boot/protocol.js";
import { createInstrumentedStep, makePlayStepMessage } from "../../src/boot/play-steps.js";

type PlayStepMessage = Extract<StoryToShell, { type: "play-step" }>;

describe("makePlayStepMessage", () => {
  it("shapes a running step without an error field", () => {
    expect(makePlayStepMessage("increments", 0, "running")).toEqual({
      type: "play-step",
      name: "increments",
      index: 0,
      status: "running",
    });
  });

  it("shapes a passed step without an error field", () => {
    expect(makePlayStepMessage("increments", 2, "passed")).toEqual({
      type: "play-step",
      name: "increments",
      index: 2,
      status: "passed",
    });
  });

  it("serializes the cause into an error field for a failed step", () => {
    const message = makePlayStepMessage("fails", 1, "failed", new Error("boom"));
    expect(message).toMatchObject({
      type: "play-step",
      name: "fails",
      index: 1,
      status: "failed",
      error: { name: "Error", message: "boom" },
    });
  });

  it("omits the error field for a failed step with no cause", () => {
    expect(makePlayStepMessage("fails", 1, "failed")).toEqual({
      type: "play-step",
      name: "fails",
      index: 1,
      status: "failed",
    });
  });
});

describe("createInstrumentedStep", () => {
  it("posts running then passed with monotonic indices across steps", async () => {
    const posted: PlayStepMessage[] = [];
    const step = createInstrumentedStep((message) => posted.push(message));

    await step("first", async () => {});
    await step("second", async () => {});

    expect(posted).toEqual([
      { type: "play-step", name: "first", index: 0, status: "running" },
      { type: "play-step", name: "first", index: 0, status: "passed" },
      { type: "play-step", name: "second", index: 1, status: "running" },
      { type: "play-step", name: "second", index: 1, status: "passed" },
    ]);
  });

  it("awaits the body between running and passed", async () => {
    const posted: PlayStepMessage[] = [];
    const step = createInstrumentedStep((message) => posted.push(message));
    let bodyRan = false;

    await step("waits", async () => {
      await Promise.resolve();
      bodyRan = true;
    });

    expect(bodyRan).toBe(true);
    expect(posted.map((message) => message.status)).toEqual(["running", "passed"]);
  });

  it("posts running then failed and rethrows a wrapped step error", async () => {
    const posted: PlayStepMessage[] = [];
    const step = createInstrumentedStep((message) => posted.push(message));

    await expect(
      step("broken", () => {
        throw new Error("inner");
      }),
    ).rejects.toThrow('step "broken" failed: inner');

    expect(posted).toEqual([
      { type: "play-step", name: "broken", index: 0, status: "running" },
      expect.objectContaining({
        type: "play-step",
        name: "broken",
        index: 0,
        status: "failed",
        error: expect.objectContaining({ message: 'step "broken" failed: inner' }),
      }),
    ]);
  });
});
