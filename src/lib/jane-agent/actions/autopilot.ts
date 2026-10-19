import { setAutopilot } from "@/lib/autopilot";
import type { ActionHandler } from "./handler";

// "Pause autopilot" (spec step 84), offered when the person types "pause autopilot": moves
// them to "Ask me first" through Settings' own code (src/lib/autopilot.ts), so Jane asks
// before doing anything from then on. Work already started is left as it is.

export const autopilotPause: ActionHandler = {
  id: "autopilot.pause",
  on: "open",
  async run({ userId, action, client, now }) {
    await setAutopilot(userId, "ask", { client, now });
    return {
      answeredWith: action.label,
      note: "Autopilot is paused. I'll ask you before doing anything. Turn it back on in Settings.",
    };
  },
};
