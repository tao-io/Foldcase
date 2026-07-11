// Minimal smoke story for Phase 3. Renders a Solid component without any
// react-grab dependencies. Used to verify the boot + adapter pipeline before
// the real react-grab stories come online in Phase 5/6.

import type { Component } from "solid-js";
import type { Meta, StoryObj } from "foldcase/solid";
import { expect, waitFor } from "foldcase/test";

interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";
}

const Button: Component<ButtonProps> = (props) => (
  <button
    data-openstory-test="simple-button"
    data-variant={props.variant ?? "primary"}
    style={{
      padding: "8px 16px",
      "background-color": props.variant === "secondary" ? "#ffffff" : "#1a1a1a",
      color: props.variant === "secondary" ? "#1a1a1a" : "#ffffff",
      border: "1px solid #1a1a1a",
      "border-radius": "8px",
      "font-size": "14px",
      cursor: "pointer",
    }}
  >
    {props.label}
  </button>
);

const meta: Meta<ButtonProps> = {
  title: "Simple/Button",
  render: (args) => <Button {...args} />,
  args: {
    label: "Hello Openstory",
    variant: "primary",
  },
  argTypes: {
    label: { control: "text" },
    variant: { control: "select", options: ["primary", "secondary"] },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { label: "Primary action", variant: "primary" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const button = canvasElement.querySelector("[data-openstory-test='simple-button']");
      expect(button).not.toBeNull();
      expect(button?.getAttribute("data-variant")).toBe("primary");
    });
  },
};

export const Secondary: Story = {
  args: { label: "Secondary action", variant: "secondary" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const button = canvasElement.querySelector("[data-openstory-test='simple-button']");
      expect(button).not.toBeNull();
      expect(button?.getAttribute("data-variant")).toBe("secondary");
    });
  },
};
