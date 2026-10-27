import { formatCents } from "@/lib/money";
import { monthLabel } from "@/lib/day-label";

// The monthly money report (spec step 148). Pure: the month's figures in, Jane's words and
// the page each figure comes from out. Every figure is taken from the loader of the page
// it links to, so the two always agree (src/lib/monthly-report.ts).

export type ReportReceipt = { title: string; cents: number; yearly: boolean; proof: string };

export type MonthlyReport = {
  month: string;
  // Confirmed savings: the total on /saved, and what was confirmed this month.
  saved: { totalCents: number; monthCents: number };
  // What came in this month, as on the month's check-in.
  earnedCents: number;
  // Payments toward cards and loans this month, as on the month's check-in.
  paidDownCents: number;
  // Transfers that went through this month, as on /transfers.
  moved: { cents: number; count: number };
  // The next best thing (spec step 143), as on /jane.
  next: { title: string; href: string } | null;
  // The money health score now and its change since the month's own, as on /jane.
  health: { score: number; band: string; change: number | null } | null;
  // Spec step 205: how the month went against the year's plan, and next month's targets.
  // Spec step 207: what worked this month and what didn't show.
  worked?: { confirmed: number; notShown: number } | null;
  plan?: {
    planned: { saving: number; debt: number; investing: number };
    did: { saving: number; debt: number; investing: number } | null;
    nextTargets: { saving: number; debt: number; investing: number };
  } | null;
  receipts: ReportReceipt[];
  // Folded in from the monthly check-in (spec step 45; docs/feature-audit.md, cluster 2), so
  // one report and one email cover the month. Optional: reports kept before then lack them.
  // Claude's short summary of the month (fixed wording without a key), as on the page.
  summary?: string;
  // Spending this month and the month before, as on /insights.
  spent?: { cents: number; previousCents: number };
  // Budgets kept, and the categories that went over, as on /budgets.
  budgets?: { kept: number; over: string[] };
  // Net worth at the start and end of the month, as on /net-worth.
  netWorth?: { startCents: number; endCents: number } | null;
  // December's report only: the year in review (spec step 35), as on /year.
  year?: YearInReport | null;
};

export type YearInReport = {
  year: number;
  spendingCents: number;
  incomeCents: number;
  found: number;
  foundAnnualCents: number;
  savedCents: number;
};

export type ReportLine = { label: string; text: string; href: string };

export const receiptWords = (r: ReportReceipt) =>
  `${r.title}: ${formatCents(r.cents)}${r.yearly ? " a year" : " back"}`;

const signed = (cents: number) => `${cents >= 0 ? "up" : "down"} ${formatCents(Math.abs(cents))}`;

// One line per figure, each with the page it comes from.
export function reportLines(report: MonthlyReport): ReportLine[] {
  const page = `/monthly?m=${report.month}`;
  const lines: ReportLine[] = [];
  if (report.spent) {
    lines.push({
      label: "Spent",
      text: `${formatCents(report.spent.cents)}, ${signed(report.spent.cents - report.spent.previousCents)} from the month before.`,
      href: "/insights",
    });
  }
  lines.push(
    {
      label: "Saved",
      text:
        report.saved.monthCents > 0
          ? `${formatCents(report.saved.monthCents)} confirmed this month, ${formatCents(report.saved.totalCents)} in all.`
          : `${formatCents(report.saved.totalCents)} confirmed in all; nothing new confirmed this month.`,
      href: "/saved",
    },
    { label: "Earned", text: `${formatCents(report.earnedCents)} came in.`, href: "/insights" },
    {
      label: "Paid down",
      text: `${formatCents(report.paidDownCents)} toward cards and loans.`,
      href: page,
    },
    {
      label: "Moved",
      text:
        report.moved.count === 0
          ? "No transfers went through."
          : `${formatCents(report.moved.cents)} in ${report.moved.count} ${report.moved.count === 1 ? "transfer" : "transfers"} (sample transfers: no real money moves).`,
      href: "/transfers",
    },
  );
  if (report.budgets && report.budgets.kept + report.budgets.over.length > 0) {
    const { kept, over } = report.budgets;
    lines.push({
      label: "Budgets",
      text:
        over.length === 0
          ? `You kept every budget (${kept}).`
          : `You kept ${kept} and went over in ${over.join(" and ")}.`,
      href: "/budgets",
    });
  }
  if (report.netWorth) {
    const { startCents, endCents } = report.netWorth;
    lines.push({
      label: "Net worth",
      text: `${formatCents(endCents)}, ${signed(endCents - startCents)} over the month.`,
      href: "/net-worth",
    });
  }
  if (report.health) {
    const change = report.health.change;
    lines.push({
      label: "Money health",
      text: `${report.health.score} out of 100 (${report.health.band})${
        change === null
          ? "."
          : change === 0
            ? ", the same as last month."
            : change > 0
              ? `, up ${change} from last month.`
              : `, ${-change} lower than last month.`
      }`,
      href: "/jane#health",
    });
  }
  if (report.worked && (report.worked.confirmed > 0 || report.worked.notShown > 0)) {
    const { confirmed, notShown } = report.worked;
    lines.push({
      label: "What worked",
      text: `${confirmed} ${confirmed === 1 ? "change" : "changes"} showed up in your transactions${notShown > 0 ? `; ${notShown} ${notShown === 1 ? "never did, so it no longer counts" : "never did, so they no longer count"}` : ""}.`,
      href: "/saved",
    });
  }
  if (report.plan) {
    const t = report.plan.nextTargets;
    const planned =
      report.plan.planned.saving + report.plan.planned.debt + report.plan.planned.investing;
    const did = report.plan.did
      ? report.plan.did.saving + report.plan.did.debt + report.plan.did.investing
      : null;
    lines.push({
      label: "Your plan",
      text: `${did === null ? "" : `You did ${formatCents(did)} of ${formatCents(planned)} planned. `}This month: saving ${formatCents(t.saving)}, extra debt ${formatCents(t.debt)}, investing ${formatCents(t.investing)}.`,
      href: "/plan",
    });
  }
  if (report.year) {
    const y = report.year;
    lines.push({
      label: `Your ${y.year}`,
      text: `You spent ${formatCents(y.spendingCents)} and ${formatCents(y.incomeCents)} came in. I found ${y.found} ${y.found === 1 ? "way" : "ways"} to save (${formatCents(y.foundAnnualCents)} a year), and changes you finished save about ${formatCents(y.savedCents)} a year.`,
      href: `/year?y=${y.year}`,
    });
  }
  lines.push({
    label: "What's next",
    text: report.next ? `${report.next.title}.` : "Nothing waiting on you.",
    href: report.next?.href ?? "/jane",
  });
  return lines;
}

export function reportBody(report: MonthlyReport, receiptLimit: number): string {
  const lines = reportLines(report).map((l) => `${l.label}: ${l.text}`);
  const receipts = report.receipts.slice(0, receiptLimit).map(receiptWords);
  const more = report.receipts.length - receipts.length;
  return [
    `Your money report for ${monthLabel(report.month, { long: true })} is ready.`,
    ...lines,
    ...(receipts.length > 0
      ? [`Receipts: ${receipts.join("; ")}${more > 0 ? `; and ${more} more on the page` : ""}.`]
      : []),
  ].join("\n");
}
