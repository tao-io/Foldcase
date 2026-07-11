import { Schema as S } from "effect";
import type { Command } from "foldkit";
import { html } from "foldkit/html";
import { m } from "foldkit/message";
import type { Meta, StoryObj } from "foldcase/foldkit";

interface A11yArgs {
  withAlt: boolean;
}

const Model = S.Struct({
  withAlt: S.Boolean,
});
interface Model {
  withAlt: boolean;
}

const Noop = m("Noop");

const Message = S.Union([Noop]);
type Message = typeof Message.Type;

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

const update = (model: Model): UpdateReturn => [model, []];

const view = (model: Model) => {
  const h = html<Message>();
  const attributes = model.withAlt
    ? [h.Src("https://example.test/logo.png"), h.Alt("A descriptive alt text")]
    : [h.Src("https://example.test/logo.png")];
  return h.div([h.DataAttribute("openstory-test", "a11y-root")], [h.img(attributes)]);
};

const makeProgram = (args: A11yArgs) => ({
  Model,
  init: (): UpdateReturn => [{ withAlt: args.withAlt }, []],
  update,
  view,
  devTools: false,
});

const meta: Meta<A11yArgs> = {
  title: "A11y/Image",
  render: (args) => makeProgram(args),
  args: {
    withAlt: false,
  },
};

export default meta;

type Story = StoryObj<A11yArgs>;

export const Violation: Story = {
  args: { withAlt: false },
};

export const Clean: Story = {
  args: { withAlt: true },
};
