import { REVIEW_DAYS } from "@/config/plan-upkeep";
import { formatCents } from "@/lib/money";
import type { TuneUpChange } from "@/planning/tune-up";
import type { Snapshot } from "./snapshot";
import type { Reply } from "./replies";

// The weekly review (spec step 101): what Jane did, what it saved, what's next and one
// decision at most. Pure: the snapshot in, the words and buttons out. Also the words for
// budget tune-ups and transfers counted toward goals.

const DAY_MS = 24 * 60 * 60 * 1000;
const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

export function tuneUpLines(changes: readonly TuneUpChange[]): string {
  return changes
    .map((c) => `${c.category} ${formatCents(c.fromCents)} → ${formatCents(c.toCents)}`)
    .join("; ");
}

export function weeklyReview(snapshot: Snapshot, now: Date): Reply {
  const since = now.getTime() - REVIEW_DAYS * DAY_MS;
  const finished = snapshot.finished.filter(
    (a) => a.completedAt !== null && a.completedAt.getTime() >= since,
  );
  const byRule = snapshot.ruleApprovals.filter((a) => a.createdAt.getTime() >= since);
  const savedCents = finished.reduce((sum, a) => sum + (a.confirmedCents ?? 0), 0);
  const tuned = snapshot.upkeep?.tuneUp?.status === "auto";
  const counted = snapshot.upkeep?.counted ?? [];

  const did: string[] = [];
  if (finished.length > 0) {
    did.push(
      `finished ${things(finished.length)} (${finished.map((a) => `"${a.title}"`).join(", ")})`,
    );
  }
  if (byRule.length > 0) did.push(`said yes to ${things(byRule.length)} under your rules`);
  if (tuned) did.push("tuned your budgets for the month");
  if (counted.length > 0) {
    const cents = counted.reduce((sum, c) => sum + c.amountCents, 0);
    did.push(`counted ${formatCents(cents)} of transfers toward your goal`);
  }

  const bills = snapshot.comingUp.filter(
    (r) => r.href === "/bills" && r.daysLeft >= 0 && r.daysLeft <= REVIEW_DAYS,
  );
  const next: string[] = [];
  if (bills.length > 0) next.push(`${bills.length} ${bills.length === 1 ? "bill" : "bills"} due`);
  if (snapshot.plan.items > 0) next.push(`${things(snapshot.plan.items)} on your plan`);
  if (snapshot.waitingOnYou.length > 0) {
    next.push(`${things(snapshot.waitingOnYou.length)} waiting on you`);
  }

  const decision = snapshot.findings[0];
  const lines = [
    "Your week with Jane:",
    `- Done: ${did.length > 0 ? `I ${did.join("; ")}.` : "nothing finished this week. I'm still watching."}`,
    `- Saved: ${savedCents > 0 ? `${formatCents(savedCents)} confirmed back or saved.` : "nothing confirmed yet this week."}`,
    `- Next week: ${next.length > 0 ? `${next.join(", ")}.` : "nothing due that I know of."}`,
    ...(decision ? [`- One to decide: ${decision.title}. ${decision.savings}.`] : []),
  ];
  return {
    body: lines.join("\n"),
    actions: decision
      ? [
          { id: "finding.yes", label: "Yes", kind: "primary" },
          { id: "finding.no", label: "No", kind: "secondary" },
          { id: "open", label: "Open", kind: "link", href: `/report/${decision.findingId}` },
        ]
      : [{ id: "open", label: "See the plan", kind: "link", href: "/plan" }],
    refs: decision ? { findingId: decision.findingId, fingerprint: decision.fingerprint } : {},
  };
}
