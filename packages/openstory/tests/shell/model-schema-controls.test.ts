import { describe, expect, it } from "vitest";
import { modelSchemaToControls } from "../../src/shell/src/lib/model-schema-controls.js";

describe("modelSchemaToControls", () => {
  it("maps a string property to a text control", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: { label: { type: "string" } },
    });
    expect(controls).toEqual([{ name: "label", control: "text" }]);
  });

  it("maps a boolean property to a boolean control", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: { enabled: { type: "boolean" } },
    });
    expect(controls).toEqual([{ name: "enabled", control: "boolean" }]);
  });

  it("maps an effect Schema.Number (anyOf with NaN/Infinity branches) to a number control", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: {
        count: {
          anyOf: [
            { type: "number" },
            { type: "string", enum: ["NaN"] },
            { type: "string", enum: ["Infinity"] },
            { type: "string", enum: ["-Infinity"] },
          ],
        },
      },
    });
    expect(controls).toEqual([{ name: "count", control: "number" }]);
  });

  it("maps a string enum to a select control with options", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: { size: { type: "string", enum: ["Small", "Large"] } },
    });
    expect(controls).toEqual([{ name: "size", control: "select", options: ["Small", "Large"] }]);
  });

  it("maps a literals union (anyOf of const) to a select control", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: {
        direction: { anyOf: [{ const: "Horizontal" }, { const: "Vertical" }] },
      },
    });
    expect(controls).toEqual([
      { name: "direction", control: "select", options: ["Horizontal", "Vertical"] },
    ]);
  });

  it("marks nested object / array properties as unsupported", () => {
    const controls = modelSchemaToControls({
      type: "object",
      properties: {
        nested: { type: "object", properties: { inner: { type: "string" } } },
      },
    });
    expect(controls).toEqual([{ name: "nested", control: "unsupported" }]);
  });
});
