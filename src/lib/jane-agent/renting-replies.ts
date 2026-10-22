import { RENTING_SOURCES } from "@/config/renting";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { Renting } from "@/lib/renting";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about renting (spec step 248), from src/lib/renting.ts. Pure. Rent reporting
// starts only on the person's yes; the deposit dates are facts from the state's law, to confirm.

export const RENTING_PAGE: MessageAction = {
  id: "open",
  label: "Your rent",
  kind: "link",
  href: "/loans/renting",
};

export const reportOnButton = (): MessageAction => ({
  id: "rent.report_on",
  label: "Yes, report my rent",
  kind: "primary",
});

export function depositLines(d: Renting): string[] {
  return d.deposits.map((x) => {
    const v = x.view;
    const head = `${formatCents(x.amountCents)} deposit (${x.state})`;
    if (v.status === "returned") {
      return `- ${head}: returned${x.returnedCents !== null ? ` ${formatCents(x.returnedCents)}` : ""}.`;
    }
    if (v.status === "waiting_for_move_out") {
      return `- ${head}: tell me the day you move out and I'll count the days it's due back (${v.rule.days} in ${x.state}).`;
    }
    const when =
      v.status === "overdue"
        ? `it was due back ${dayLabel(v.dueOn!)}, ${Math.abs(v.daysLeft!)} ${Math.abs(v.daysLeft!) === 1 ? "day" : "days"} ago`
        : `due back by ${dayLabel(v.dueOn!)}, ${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} from now`;
    return `- ${head}: ${when}. ${v.rule.note} (${v.rule.source}; check your lease and local rules.)`;
  });
}

export function rentingReply(d: Renting): Reply {
  if (!d.renter && d.deposits.length === 0) {
    return {
      body: "I don't see rent payments in your bank data, so there's nothing to report or compare yet. If you've moved out and want a deposit followed, add it on your rent page.",
      actions: [RENTING_PAGE],
      refs: {},
    };
  }
  const lines: string[] = [];
  const actions: MessageAction[] = [];
  if (d.renter) {
    lines.push(`You pay ${formatCents(d.monthlyCents!)} in rent each month.`);
    if (d.reporting.on) {
      lines.push(
        `Your rent is being reported to the credit bureaus (since ${dayLabel(d.reporting.since!)}). You can turn it off on your rent page.`,
      );
    } else {
      lines.push(
        `It isn't on your credit file. ${d.reporting.note} It costs about ${formatCents(d.reporting.monthlyFeeCents)} a month and only starts if you say yes.`,
      );
      actions.push(reportOnButton());
    }
    if (d.rise) {
      lines.push(
        `Your rent went up from ${formatCents(d.rise.beforeCents)} to ${formatCents(d.rise.nowCents)}, ${(d.rise.risePercentBps / 100).toFixed(1)}%: ${formatCents(d.rise.yearlyExtraCents)} more a year. A usual rise is about ${(d.rise.usualBps / 100).toFixed(0)}% (${d.localRent.label.toLowerCase()}, not your landlord's market).${d.rise.askAbout ? " That's enough to ask your landlord about." : ""}`,
      );
    }
  }
  if (d.deposits.length > 0) lines.push("Your deposits:", ...depositLines(d));
  lines.push(`Sources: ${RENTING_SOURCES.map((s) => s.label).join("; ")}.`);
  return { body: lines.join("\n"), actions: [...actions, RENTING_PAGE], refs: {} };
}
