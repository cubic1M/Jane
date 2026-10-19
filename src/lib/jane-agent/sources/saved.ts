import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { SAVED_MILESTONES_CENTS } from "@/config/saved";
import { formatCents } from "@/lib/money";
import type { Candidate } from "../types";
import type { MessageSource } from "./source";

// What Jane saved you (spec step 139): when the confirmed total passes a milestone, Jane
// says so once, with the receipts and a way to share it. Only the highest milestone passed.
export const savedSource: MessageSource = {
  key: "saved",
  gather(snapshot): Candidate[] {
    const total = snapshot.saved?.confirmedCents ?? 0;
    const milestone = [...SAVED_MILESTONES_CENTS].reverse().find((m) => total >= m);
    if (!milestone) return [];
    return [
      {
        kind: "done",
        body: `I've now saved you ${formatCents(total)}, and every dollar of it shows in your own transactions: refunds that came back and bills that went down. Want to share your total?`,
        refs: {},
        actions: [
          { id: "saved.share", label: "Share it", kind: "primary" },
          { id: "open", label: "See the receipts", kind: "link", href: "/saved" },
        ],
        dedupeKey: `milestone:${milestone}`,
        priority: MESSAGE_PRIORITY.saved_milestone,
      },
    ];
  },
};
