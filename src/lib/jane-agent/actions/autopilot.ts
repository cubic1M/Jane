import type { AutopilotChoice } from "@/config/autopilot";
import { autopilotOf, setAutopilot } from "@/lib/autopilot";
import { scopedFor } from "@/lib/db-scoped";
import { things } from "../sources/source";
import type { ActionId } from "../types";
import { autopilotBefore, keepChoice } from "./choice";
import { answeredElsewhere, type ActionHandler } from "./handler";

// The autopilot question's three buttons (spec step 83), through setAutopilot like
// Settings: it sets the standing rules and applies them at once. A level can never approve
// moving money, calls, cancellations or insurance (NEVER_BY_RULE). Only while the person
// hasn't picked one yet; after that it's changed in Settings, or taken back with the message's
// Revert (./choice.ts), which keeps the three choices on it.

const started = (n: number) => (n > 0 ? ` I've started on ${things(n)} already.` : "");

const NOTES: Record<AutopilotChoice, (n: number) => string> = {
  safe: (n) =>
    `Done. I'll handle the safe stuff on my own and tell you each time; you can take anything back for a day.${started(n)}`,
  all: (n) =>
    `Done. I'll handle everything allowed on my own. Moving money, calls, cancelling and insurance still wait for your yes.${started(n)}`,
  ask: () => "Got it. I'll ask you before doing anything.",
};

function choose(level: AutopilotChoice): ActionHandler {
  return {
    id: `autopilot.${level}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }) {
      if ((await autopilotOf(userId, { client })) !== null) {
        throw answeredElsewhere(
          "You've already picked how much I do on my own. You can change it in Settings.",
        );
      }
      // What Revert puts back (founder, 2026-10-25): the choices stay, greyed, with Revert.
      const before = await autopilotBefore(userId, client);
      const approved = await setAutopilot(userId, level, { client, now });
      // The agent's first steps on what the new level approved, as Settings starts them.
      const working = await scopedFor(userId, client).actions.findMany({
        where: { agentState: "working" },
        select: { id: true },
      });
      return {
        answeredWith: action.label,
        note: NOTES[level](approved),
        agentActionIds: working.map((a) => a.id),
        ...keepChoice(message, action, { autopilot: before }),
      };
    },
  };
}

export const autopilotSafe = choose("safe");
export const autopilotAll = choose("all");
export const autopilotAsk = choose("ask");

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
