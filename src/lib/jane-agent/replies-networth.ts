import { formatCents } from "@/lib/money";
import type { netWorth } from "@/insights/net-worth";
import type { Reply } from "./replies";

// "What's my net worth?": what they own less what they owe, as the net worth page says it.
export function netWorthReply(worth: ReturnType<typeof netWorth>): Reply {
  const link = {
    id: "open" as const,
    label: "See net worth",
    kind: "link" as const,
    href: "/net-worth",
  };
  if (worth.assetsCents === 0 && worth.debtsCents === 0) {
    return {
      body: "I can't work out your net worth yet: link an account or add something you own, and I'll add it up.",
      actions: [{ id: "open", label: "Link a bank", kind: "link", href: "/connect" }],
      refs: {},
    };
  }
  const crypto =
    worth.cryptoCents > 0
      ? ` That includes ${formatCents(worth.cryptoCents)} of crypto I only read.`
      : "";
  const missing =
    worth.missing.length > 0
      ? ` ${worth.missing.length} ${worth.missing.length === 1 ? "account has" : "accounts have"} no balance yet, so it isn't counted.`
      : "";
  return {
    body: `Your net worth is ${formatCents(worth.netCents)}: you have ${formatCents(worth.assetsCents)} and owe ${formatCents(worth.debtsCents)}.${crypto}${missing}`,
    actions: [link],
    refs: {},
  };
}
