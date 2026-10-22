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
      { label: "Earned", text: "$7,900.00 came in.", href: "/insights" },
      {
        label: "Paid down",
        text: "$3,180.64 toward cards and loans.",
        href: "/monthly?m=2026-09",
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

describe("the check-in's figures and the year, in the one report", () => {
  // docs/feature-audit.md, cluster 2: the monthly check-in (spec step 45) and the year in
  // review (spec step 35) are part of the report.
  const merged: MonthlyReport = {
    ...report,
    summary: "In September you spent $2,400.00, down $100.00 from the month before.",
    spent: { cents: 240_000, previousCents: 250_000 },
    budgets: { kept: 2, over: ["Shopping"] },
    netWorth: { startCents: 1_000_000, endCents: 1_050_000 },
  };

  it("says spending, budgets and net worth, each with its page", () => {
    const lines = reportLines(merged);
    expect(lines[0]).toEqual({
      label: "Spent",
      text: "$2,400.00, down $100.00 from the month before.",
      href: "/insights",
    });
    expect(lines.find((l) => l.label === "Budgets")).toEqual({
      label: "Budgets",
      text: "You kept 2 and went over in Shopping.",
      href: "/budgets",
    });
    expect(lines.find((l) => l.label === "Net worth")).toEqual({
      label: "Net worth",
      text: "$10,500.00, up $500.00 over the month.",
      href: "/net-worth",
    });
    expect(
      reportLines({ ...merged, budgets: { kept: 3, over: [] } }).find((l) => l.label === "Budgets")
        ?.text,
    ).toBe("You kept every budget (3).");
    // No budgets, no line; reports kept before the merge have none of these.
    expect(
      reportLines({ ...merged, budgets: { kept: 0, over: [] } }).map((l) => l.label),
    ).not.toContain("Budgets");
    expect(reportLines(report).map((l) => l.label)).not.toContain("Spent");
  });

  it("adds the year in December, linking to the printable year", () => {
    const december = reportLines({
      ...merged,
      month: "2026-12",
      year: {
        year: 2026,
        spendingCents: 3_000_000,
        incomeCents: 9_000_000,
        found: 7,
        foundAnnualCents: 120_000,
        savedCents: 45_000,
      },
    });
    expect(december.find((l) => l.label === "Your 2026")).toEqual({
      label: "Your 2026",
      text: "You spent $30,000.00 and $90,000.00 came in. I found 7 ways to save ($1,200.00 a year), and changes you finished save about $450.00 a year.",
      href: "/year?y=2026",
    });
    // Just before "What's next".
    expect(december.at(-2)?.label).toBe("Your 2026");
    expect(reportLines(merged).map((l) => l.label)).not.toContain("Your 2026");
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
