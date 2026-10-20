import { describe, expect, it } from "vitest";
import { reportBody, reportLines, type MonthlyReport } from "./monthly-report";

// Spec step 148, pure: the month's figures in Jane's words, each with the page it comes
// from.

const report: MonthlyReport = {
  month: "2026-09",
  saved: { totalCents: 42_000, monthCents: 12_000 },
  earnedCents: 790_000,
  paidDownCents: 318_064,
  moved: { cents: 40_000, count: 2 },
  next: { title: "Cancel Hulu", href: "/report/f1" },
  health: { score: 72, band: "Steady", change: 4 },
  receipts: [
    { title: "Lowered Comcast", cents: 12_000, yearly: true, proof: "Sep 12: $70.00, was $80.00." },
    { title: "Refund from Delta", cents: 9_900, yearly: false, proof: "Sep 3: $99.00 back." },
  ],
};

describe("reportLines", () => {
  it("says each figure with the page it comes from", () => {
    expect(reportLines(report)).toEqual([
      { label: "Saved", text: "$120.00 confirmed this month, $420.00 in all.", href: "/saved" },
      { label: "Earned", text: "$7,900.00 came in.", href: "/check-in?m=2026-09" },
      {
        label: "Paid down",
        text: "$3,180.64 toward cards and loans.",
        href: "/check-in?m=2026-09",
      },
      {
        label: "Moved",
        text: "$400.00 in 2 transfers (sample transfers: no real money moves).",
        href: "/transfers",
      },
      {
        label: "Money health",
        text: "72 out of 100 (Steady), up 4 from last month.",
        href: "/jane#health",
      },
      { label: "What's next", text: "Cancel Hulu.", href: "/report/f1" },
    ]);
  });

  it("says a quiet month plainly", () => {
    const quiet = reportLines({
      ...report,
      saved: { totalCents: 0, monthCents: 0 },
      moved: { cents: 0, count: 0 },
      next: null,
      health: { score: 60, band: "Steady", change: -3 },
    });
    expect(quiet.map((l) => l.text)).toEqual([
      "$0.00 confirmed in all; nothing new confirmed this month.",
      "$7,900.00 came in.",
      "$3,180.64 toward cards and loans.",
      "No transfers went through.",
      "60 out of 100 (Steady), 3 lower than last month.",
      "Nothing waiting on you.",
    ]);
  });
});

describe("reportBody", () => {
  it("opens with the month and lists a few receipts", () => {
    const body = reportBody(report, 1);
    expect(body.split("\n")[0]).toBe("Your money report for September 2026 is ready.");
    expect(body).toContain("Saved: $120.00 confirmed this month, $420.00 in all.");
    expect(body).toContain("Receipts: Lowered Comcast: $120.00 a year; and 1 more on the page.");
  });
});
