import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Fully automatic investing in the chat (spec step 164): one summary a month of what Jane
// did within the person's caps and what she asked about instead. Every line is from the log.

export const AUTO_LOG_LINK: MessageAction = {
  id: "open",
  label: "See the log",
  kind: "link",
  href: "/settings#autopilot",
};

type Entry = { what: string; cents: number };

export function summaryBody(did: Entry[], asked: Entry[]): string {
  const total = did.reduce((s, e) => s + e.cents, 0);
  const done =
    did.length > 0
      ? `This month I handled ${did.length} ${did.length === 1 ? "thing" : "things"} in your investments by myself, ${formatCents(total)} in all, within your caps: ${did.map((e) => e.what).join("; ")}.`
      : "I didn't need to change anything in your investments by myself this month.";
  const wait =
    asked.length > 0
      ? ` Over your caps, so waiting for your tap: ${asked.map((e) => e.what.replace(/^Asked first, over [^:]+: /, "")).join("; ")}.`
      : "";
  return `${done}${wait} Everything is in the log, with the reason. This was all in the simulated brokerage: no real money moved.`;
}
