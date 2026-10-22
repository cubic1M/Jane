import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { BORROW_PAGE } from "../borrowing-power-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// What you could borrow (spec step 250): when Jane's monthly soft check finds a lower likely rate
// or a bigger amount than the check before, she says so once, with the page to see the rest.

export const borrowingPowerSource: MessageSource = {
  key: "borrowing_power",
  gather: (snapshot): Candidate[] => {
    const d = snapshot.borrowingPower;
    if (!d?.available || !d.checkedOn || d.changes.length === 0) return [];
    return [
      {
        kind: "heads_up",
        body: `Good news from this month's soft check: ${d.changes.join(" ")} Checking never touches your score, and nothing is applied for.`,
        refs: {},
        actions: [BORROW_PAGE, snoozeButton()],
        dedupeKey: `borrowing:${d.checkedOn}`,
        priority: MESSAGE_PRIORITY.borrowing_power,
      },
    ];
  },
};
