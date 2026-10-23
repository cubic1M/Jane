import type { ActionHandler } from "./handler";

// "I called" on a price rise (spec step 243): noted; the next bill shows whether it held.
export const priceCalled: ActionHandler = {
  id: "price.called",
  on: "open",
  async run(context) {
    return {
      answeredWith: context.action.label,
      note: "Good. I'll check the next bill to see the price held.",
    };
  },
};
