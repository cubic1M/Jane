import { TOUR_LINKS, TOUR_NOTE } from "../replies-help";
import type { ActionHandler } from "./handler";

// "Show me around" on Jane's first-run hello (spec step 140): the tour, in place.
export const welcomeTour: ActionHandler = {
  id: "welcome.tour",
  on: "open",
  async run({ message, action }) {
    return {
      answeredWith: action.label,
      note: TOUR_NOTE,
      actions: [...message.actions.filter((a) => a.kind === "link"), ...TOUR_LINKS],
    };
  },
};
