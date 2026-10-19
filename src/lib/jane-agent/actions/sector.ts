import { SectorAutopilotError, setSectorAutopilot } from "@/lib/sector-autopilot";
import { sectorLine } from "../replies-autopilot";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// "Set it" on a sector change typed in the chat (spec step 141), through Settings' own code:
// audited, and in effect at once.
export const autopilotSectorSet: ActionHandler = {
  id: "autopilot.sector_set",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const change = message.refs.sectorChange;
    if (!change)
      throw new ChatActionError("failed", "Something went wrong. Open Settings instead.");
    try {
      const saved = await setSectorAutopilot(
        userId,
        change.sector,
        {
          level: change.level as never,
          actionCapCents: change.actionCapCents,
          monthlyCapCents: change.monthlyCapCents,
        },
        { client, now },
      );
      return { answeredWith: action.label, note: `Done. ${sectorLine(saved)}, from now on.` };
    } catch (error) {
      if (error instanceof SectorAutopilotError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};
