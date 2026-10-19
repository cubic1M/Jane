import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { tuneUpLines } from "../replies-review";
import type { Candidate } from "../types";
import { shortDate, type MessageSource } from "./source";

// Plans that keep up (spec step 101): this month's budget tune-up (Accept all, Change,
// Keep) or, when autopilot applied it, what Jane changed (with Undo); and transfers to
// savings to count toward a goal (Count it, Not this one), or the ones autopilot counted.

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
const budgetsLink = { id: "open", label: "Change", kind: "link", href: "/budgets" } as const;

export const upkeepSource: MessageSource = {
  key: "upkeep",
  gather(snapshot) {
    const upkeep = snapshot.upkeep;
    if (!upkeep) return [];
    const out: Candidate[] = [];
    const tune = upkeep.tuneUp;
    if (tune?.status === "proposed") {
      out.push({
        kind: "decision",
        body: `Budget tune-up for ${monthName(tune.month)}, from what you usually spend: ${tuneUpLines(tune.changes)}.`,
        refs: { tuneUpMonth: tune.month },
        actions: [
          { id: "tuneup.accept", label: "Accept all", kind: "primary" },
          { id: "tuneup.keep", label: "Keep", kind: "secondary" },
          budgetsLink,
        ],
        dedupeKey: `tuneup:${tune.month}`,
        priority: MESSAGE_PRIORITY.upkeep,
      });
    }
    if (tune?.status === "auto") {
      out.push({
        kind: "done",
        body: `I tuned your budgets for ${monthName(tune.month)} to what you usually spend (autopilot): ${tuneUpLines(tune.changes)}. You can undo it.`,
        refs: { tuneUpMonth: tune.month },
        actions: [
          { id: "tuneup.undo", label: "Undo", kind: "secondary" },
          { ...budgetsLink, label: "See budgets" },
        ],
        dedupeKey: `tuneup:${tune.month}:auto`,
        priority: MESSAGE_PRIORITY.upkeep,
      });
    }
    for (const t of upkeep.transfers) {
      out.push({
        kind: "decision",
        body: `You moved ${formatCents(t.amountCents)} to savings on ${shortDate(t.date)}. Count it toward your goal "${t.goal.name}"?`,
        refs: { transactionId: t.transactionId, goalId: t.goal.id },
        actions: [
          { id: "transfer.count", label: "Count it", kind: "primary" },
          { id: "transfer.skip", label: "Not this one", kind: "secondary" },
        ],
        dedupeKey: `transfer:${t.transactionId}`,
        priority: MESSAGE_PRIORITY.upkeep,
      });
    }
    for (const c of upkeep.counted) {
      out.push({
        kind: "done",
        body: `I counted the ${formatCents(c.amountCents)} you moved to savings toward "${c.goalName}" (autopilot). That's ${formatCents(c.savedCents)} of ${formatCents(c.targetCents)}.`,
        refs: {},
        actions: [{ id: "open", label: "See goals", kind: "link", href: "/goals" }],
        dedupeKey: `counted:${c.transactionId}`,
        priority: MESSAGE_PRIORITY.upkeep,
      });
    }
    return out;
  },
};
