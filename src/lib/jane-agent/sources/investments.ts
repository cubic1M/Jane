import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { snoozeButton, type MessageSource } from "./source";

// Investments in the chat (spec step 128 on). The first time Jane can see what's in the
// person's investment accounts, she says so once, with the total and where to look. At
// every autopilot level she keeps the holdings up to date by herself on each sync; there's
// nothing to approve.

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const investmentsSource: MessageSource = {
  key: "investments",
  gather(snapshot) {
    const inv = snapshot.investments;
    if (!inv || inv.holdingCount === 0) return [];
    return [
      {
        kind: "heads_up" as const,
        body: `I can see what's in your investment accounts now: ${inv.holdingCount} ${inv.holdingCount === 1 ? "holding" : "holdings"} worth ${formatCents(inv.totalCents)} in ${list(inv.accounts.map((a) => a.name))}. Every number shows where it came from, and I'll keep it up to date.`,
        refs: {},
        actions: [
          { id: "open", label: "See what you own", kind: "link", href: "/investments" } as const,
          snoozeButton(),
        ],
        dedupeKey: "holdings",
        priority: MESSAGE_PRIORITY.investments,
      },
    ];
  },
};
