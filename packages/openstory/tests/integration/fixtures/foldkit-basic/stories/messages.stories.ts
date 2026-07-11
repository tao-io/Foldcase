import { Match as M, Schema as S } from "effect";
import type { Command } from "foldkit";
import { html } from "foldkit/html";
import { m } from "foldkit/message";
import { evo } from "foldkit/struct";
import type { Meta, StoryObj } from "foldcase/foldkit";

const Model = S.Struct({
  count: S.Number,
  label: S.String,
});
interface Model {
  count: number;
  label: string;
}

const Incremented = m("Incremented");
const LabelSet = m("LabelSet", { label: S.String });

const Message = S.Union([Incremented, LabelSet]);
type Message = typeof Message.Type;

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const init = (): UpdateReturn => [{ count: 0, label: "start" }, []];

const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tagsExhaustive({
      Incremented: () => [evo(model, { count: (count) => count + 1 }), []],
      LabelSet: ({ label }) => [evo(model, { label: () => label }), []],
    }),
  );

const view = (model: Model) => {
  const h = html<Message>();
  return h.div(
    [h.DataAttribute("openstory-test", "foldkit-messages")],
    [
      h.p([h.DataAttribute("openstory-test", "msg-count")], [`Count: ${model.count}`]),
      h.p([h.DataAttribute("openstory-test", "msg-label")], [`Label: ${model.label}`]),
      h.button(
        [
          h.Type("button"),
          h.DataAttribute("openstory-test", "msg-increment"),
          h.OnClick(Incremented()),
        ],
        ["Increment"],
      ),
      h.button(
        [
          h.Type("button"),
          h.DataAttribute("openstory-test", "msg-set-label"),
          h.OnClick(LabelSet({ label: "done" })),
        ],
        ["Set label"],
      ),
    ],
  );
};

const program = {
  Model,
  init,
  update,
  view,
  devTools: false,
};

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

const meta: Meta = {
  title: "Foldkit/Messages",
  render: () => program,
};

export default meta;

type Story = StoryObj;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const click = (testId: string): void => {
      const el = canvasElement.querySelector(`[data-openstory-test='${testId}']`);
      if (!el) throw new Error(`Foldkit ${testId} was not rendered`);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    const countText = (): string | null | undefined =>
      canvasElement.querySelector("[data-openstory-test='msg-count']")?.textContent;
    const labelText = (): string | null | undefined =>
      canvasElement.querySelector("[data-openstory-test='msg-label']")?.textContent;

    await waitForPlayCondition(() =>
      Boolean(canvasElement.querySelector("[data-openstory-test='msg-increment']")),
    );
    click("msg-increment");
    await waitForPlayCondition(() => countText() === "Count: 1");
    click("msg-increment");
    await waitForPlayCondition(() => countText() === "Count: 2");
    click("msg-set-label");
    await waitForPlayCondition(() => labelText() === "Label: done");
  },
};
