import { Match as M, Schema as S } from "effect";
import type { Command } from "foldkit";
import { html } from "foldkit/html";
import { m } from "foldkit/message";
import { evo } from "foldkit/struct";
import type { Meta, StoryObj } from "foldcase/foldkit";

interface CounterArgs {
  label: string;
}

const Model = S.Struct({
  label: S.String,
  count: S.Number,
});
interface Model {
  label: string;
  count: number;
}

const ClickedIncrement = m("ClickedIncrement");

const Message = S.Union([ClickedIncrement]);
type Message = typeof Message.Type;

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const init = (label: string): UpdateReturn => [{ label, count: 0 }, []];

const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tagsExhaustive({
      ClickedIncrement: () => [evo(model, { count: (count) => count + 1 }), []],
    }),
  );

const view = (model: Model) => {
  const h = html<Message>();
  return h.div(
    [h.DataAttribute("openstory-test", "foldkit-counter")],
    [
      h.p([h.DataAttribute("openstory-test", "foldkit-label")], [model.label]),
      h.p([h.DataAttribute("openstory-test", "foldkit-count")], [`Count: ${model.count}`]),
      h.button(
        [
          h.Type("button"),
          h.DataAttribute("openstory-test", "foldkit-increment"),
          h.OnClick(ClickedIncrement()),
        ],
        ["Increment"],
      ),
    ],
  );
};

const makeProgram = (args: CounterArgs) => ({
  Model,
  init: () => init(args.label),
  update,
  view,
  devTools: false,
});

const PLAY_WAIT_INTERVAL_MS = 25;
const PLAY_WAIT_TIMEOUT_MS = 1_000;

const waitForPlayCondition = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + PLAY_WAIT_TIMEOUT_MS;
  const isReady = (): boolean => {
    try {
      return condition();
    } catch {
      return false;
    }
  };
  while (!isReady()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Foldkit story condition");
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, PLAY_WAIT_INTERVAL_MS));
  }
};

const meta: Meta<CounterArgs> = {
  title: "Foldkit/Counter",
  render: (args) => makeProgram(args),
  args: {
    label: "Foldkit story",
  },
  argTypes: {
    label: { control: "text" },
  },
};

export default meta;

type Story = StoryObj<CounterArgs>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const getButton = (): Element => {
      const button = canvasElement.querySelector("[data-openstory-test='foldkit-increment']");
      if (!button) throw new Error("Foldkit increment button was not rendered");
      return button;
    };
    await waitForPlayCondition(() => canvasElement.contains(getButton()));
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForPlayCondition(() => {
      const count = canvasElement.querySelector("[data-openstory-test='foldkit-count']");
      return count?.textContent === "Count: 1";
    });
  },
};
