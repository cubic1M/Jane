import { formatCents } from "@/lib/money";
import type { AccountForecast } from "@/detection/forecast";
import type { Reply } from "./replies";
import { shortDate } from "./sources/source";

// "Why is my checking going negative?": where each checking account is heading over the next
// month, and the bills and paychecks (on their pay schedule) that drive the lowest point.
// The same forecast as the bills page and the low-balance alerts.
const SHOWN = 3;

export function forecastReply(forecasts: AccountForecast[]): Reply {
  const link = {
    id: "open" as const,
    label: "See your bills",
    kind: "link" as const,
    href: "/bills",
  };
  const worst = [...forecasts].sort((a, b) => a.lowest.balanceCents - b.lowest.balanceCents)[0];
  if (!worst) {
    return {
      body: "I can't forecast your balance yet: link a checking account and I'll show where it's heading.",
      actions: [{ id: "open", label: "Link a bank", kind: "link", href: "/connect" }],
      refs: {},
    };
  }
  const { lowest } = worst;
  const bills = worst.bills
    .filter((b) => b.date <= lowest.date)
    .sort((a, b) => b.amountCents - a.amountCents);
  const pay = worst.income.filter((i) => i.date <= lowest.date);
  const first =
    lowest.balanceCents < 0
      ? `Yes: ${worst.accountName} is forecast to dip to ${formatCents(lowest.balanceCents)} on ${shortDate(lowest.date)}.`
      : `No: ${worst.accountName} stays above zero, with its lowest point ${formatCents(lowest.balanceCents)} on ${shortDate(lowest.date)}.`;
  const lines = [
    first,
    `It starts at ${formatCents(worst.startCents)} today.`,
    bills.length > 0
      ? `Bills before then: ${bills
          .slice(0, SHOWN)
          .map((b) => `${b.merchant} ${formatCents(b.amountCents)} on ${shortDate(b.date)}`)
          .join(", ")}${bills.length > SHOWN ? `, and ${bills.length - SHOWN} more` : ""}.`
      : null,
    pay.length > 0
      ? `Paychecks counted: ${pay.map((p) => `${p.merchant} ${formatCents(p.amountCents)} on ${shortDate(p.date)}`).join(", ")}.`
      : "No paycheck is expected before then.",
  ].filter((l): l is string => Boolean(l));
  return { body: lines.join("\n"), actions: [link], refs: {} };
}
