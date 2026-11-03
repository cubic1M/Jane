import { formatCents } from "@/lib/money";
import { loansNotCounted, notCounting, owedIsKnown, type netWorth } from "@/insights/net-worth";
import type { Reply } from "./replies";

// "What's my net worth?": what they own less what they owe, as the net worth page says it.
export function netWorthReply(
  worth: ReturnType<typeof netWorth>,
  loansSeen: readonly string[] = [],
): Reply {
  const link = {
    id: "open" as const,
    label: "See net worth",
    kind: "link" as const,
    href: "/net-worth",
  };
  const left = notCounting(worth.unbalanced);
  // Accounts there, but no balance on any: not known, never $0 (QA rounds 6-7).
  if (!worth.known && left) {
    return {
      body: `I don't know your net worth yet. ${left.sentence} Add a balance and I'll add it up.`,
      actions: [link],
      refs: {},
    };
  }
  if (worth.assetsCents === 0 && worth.debtsCents === 0) {
    return {
      body: "I can't work out your net worth yet: add your accounts or something you own, and I'll add it up.",
      actions: [{ id: "open", label: "Add your accounts", kind: "link", href: "/connect" }],
      refs: {},
    };
  }
  const crypto =
    worth.cryptoCents > 0
      ? ` That includes ${formatCents(worth.cryptoCents)} of crypto I only read.`
      : "";
  const loans = loansNotCounted(loansSeen);
  const missing = `${left ? ` ${left.sentence}` : ""}${loans ? ` ${loans}` : ""}`;
  const owed = owedIsKnown(worth, loansSeen)
    ? ` and owe ${formatCents(worth.debtsCents)}.`
    : "; I can't see everything you owe.";
  return {
    body: `Your net worth is ${formatCents(worth.netCents)}: you have ${formatCents(worth.assetsCents)}${owed}${crypto}${missing}`,
    actions: [link],
    refs: {},
  };
}
