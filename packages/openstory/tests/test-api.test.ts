// Verifies openstory/test re-exports the expected API surface for play functions.
// Runs against the built dist/test.js so we catch packaging bugs (e.g.
// missing exports field, wrong file extension), not just source.

import { describe, expect, it } from "vitest";

const loadOpenstoryTest = async (): Promise<Record<string, unknown>> => {
  const mod = (await import("foldcase/test")) as Record<string, unknown>;
  return mod;
};

describe("foldcase/test API surface", () => {
  it("exports the full play-function toolkit", async () => {
    const api = await loadOpenstoryTest();

    // Vitest-side
    expect(typeof api["expect"]).toBe("function");
    expect(typeof api["vi"]).toBe("object");
    const vi = api["vi"] as { fn: unknown };
    expect(typeof vi.fn).toBe("function");

    // Testing-library DOM helpers
    expect(typeof api["within"]).toBe("function");
    expect(typeof api["screen"]).toBe("object");
    expect(typeof api["fireEvent"]).toBe("function");
    expect(typeof api["waitFor"]).toBe("function");
    expect(typeof api["waitForElementToBeRemoved"]).toBe("function");

    // user-event
    expect(typeof api["userEvent"]).toBe("object");
    const ue = api["userEvent"] as { setup: unknown };
    expect(typeof ue.setup).toBe("function");

    // Openstory-specific helper
    expect(typeof api["step"]).toBe("function");
  });

  it("step() wraps a function and propagates errors with named context", async () => {
    const api = await loadOpenstoryTest();
    const step = api["step"] as (n: string, f: () => Promise<void>) => Promise<void>;
    await expect(
      step("seed localStorage", async () => {
        // ok
      }),
    ).resolves.toBeUndefined();

    let caught: Error | undefined;
    try {
      await step("flaky step", async () => {
        throw new Error("boom");
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('step "flaky step" failed');
    expect(caught!.message).toContain("boom");
  });

  it("vi.fn() creates a spy you can call inside play functions", async () => {
    const api = await loadOpenstoryTest();
    const vi = api["vi"] as { fn: () => (...args: unknown[]) => unknown };
    const spy = vi.fn() as { mock: { calls: unknown[][] } } & ((...args: unknown[]) => unknown);
    spy("hello");
    spy("world");
    expect(spy.mock.calls.length).toBe(2);
    expect(spy.mock.calls[0]).toEqual(["hello"]);
    expect(spy.mock.calls[1]).toEqual(["world"]);
  });
});
