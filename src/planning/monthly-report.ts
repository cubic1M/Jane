import { formatCents } from "@/lib/money";

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
  receipts: ReportReceipt[];
};

export type ReportLine = { label: string; text: string; href: string };

export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export const receiptWords = (r: ReportReceipt) =>
  `${r.title}: ${formatCents(r.cents)}${r.yearly ? " a year" : " back"}`;

// One line per figure, each with the page it comes from.
export function reportLines(report: MonthlyReport): ReportLine[] {
  const checkIn = `/check-in?m=${report.month}`;
  const lines: ReportLine[] = [
    {
      label: "Saved",
      text:
        report.saved.monthCents > 0
          ? `${formatCents(report.saved.monthCents)} confirmed this month, ${formatCents(report.saved.totalCents)} in all.`
          : `${formatCents(report.saved.totalCents)} confirmed in all; nothing new confirmed this month.`,
      href: "/saved",
    },
    { label: "Earned", text: `${formatCents(report.earnedCents)} came in.`, href: checkIn },
    {
      label: "Paid down",
      text: `${formatCents(report.paidDownCents)} toward cards and loans.`,
      href: checkIn,
    },
    {
      label: "Moved",
      text:
        report.moved.count === 0
          ? "No transfers went through."
          : `${formatCents(report.moved.cents)} in ${report.moved.count} ${report.moved.count === 1 ? "transfer" : "transfers"} (sample transfers: no real money moves).`,
      href: "/transfers",
    },
  ];
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
    `Your money report for ${monthName(report.month)} is ready.`,
    ...lines,
    ...(receipts.length > 0
      ? [`Receipts: ${receipts.join("; ")}${more > 0 ? `; and ${more} more on the page` : ""}.`]
      : []),
  ].join("\n");
}
