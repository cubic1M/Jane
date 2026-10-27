import { describe, expect, it } from "vitest";
import { FEDERAL_PROTECTIONS, LONG_GAME, PSLF_PAYMENTS } from "@/config/student-loans";
import { nextOnCycle, pslfCount, refiGuide, taxOnForgiven, taxPlanDue } from "./student-long-game";
import { addMonths } from "@/lib/dates";

describe("Public Service Loan Forgiveness, month by month", () => {
  it("counts what was counted before plus one for each month a payment was seen", () => {
    const c = pslfCount({
      countedBefore: 100,
      seenMonths: ["2026-08", "2026-09", "2026-10", "2026-10"],
      asOf: "2026-10-19",
    });
    expect(c.counted).toBe(103);
    expect(c.remaining).toBe(PSLF_PAYMENTS - 103);
    // 17 more monthly payments from October.
    expect(c.forgivenOn).toBe("2028-03-01");
  });

  it("shows a window of months around today, each paid, counted before, or to come", () => {
    const c = pslfCount({
      countedBefore: 0,
      seenMonths: ["2026-09", "2026-10"],
      asOf: "2026-10-19",
    });
    expect(c.grid).toHaveLength(LONG_GAME.gridMonthsEachSide * 2 + 1);
    expect(c.grid.find((m) => m.month === "2026-10")!.state).toBe("seen");
    expect(c.grid.find((m) => m.month === "2026-07")!.state).toBe("before");
    expect(c.grid.find((m) => m.month === "2026-11")!.state).toBe("to_come");
    expect(c.grid[0].month).toBe("2026-04");
    expect(c.grid.at(-1)!.month).toBe("2027-04");
  });

  it("is done at 120, never over", () => {
    const c = pslfCount({
      countedBefore: 118,
      seenMonths: ["2026-08", "2026-09", "2026-10"],
      asOf: "2026-10-19",
    });
    expect(c).toMatchObject({ counted: PSLF_PAYMENTS, remaining: 0, forgivenOn: "2026-10-19" });
  });
});

describe("yearly dates", () => {
  it("moves a date forward a year at a time until it's today or later", () => {
    expect(nextOnCycle("2025-11-30", 12, "2026-10-19")).toBe("2026-11-30");
    expect(nextOnCycle("2024-02-29", 12, "2026-10-19")).toBe("2027-02-28");
    expect(nextOnCycle("2026-12-01", 12, "2026-10-19")).toBe("2026-12-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("the tax on forgiven debt", () => {
  it("doesn't tax Public Service Loan Forgiveness", () => {
    expect(taxOnForgiven(5_000_000, true)).toMatchObject({ taxable: false, estimateCents: 0 });
  });
  it("sizes the tax on income-driven forgiveness at the assumed rate", () => {
    const t = taxOnForgiven(5_000_000, false);
    expect(t.taxable).toBe(true);
    expect(t.estimateCents).toBe(Math.round(5_000_000 * LONG_GAME.forgivenTaxRate));
    expect(t.note).toContain("income-driven");
  });
});

describe("when the tax on forgiven debt goes on the deadlines list", () => {
  it("is two years before a taxable forgiveness, never for PSLF", () => {
    expect(taxPlanDue("2028-06-01", true, "2026-10-19")).toBe(true);
    expect(taxPlanDue("2046-06-01", true, "2026-10-19")).toBe(false);
    expect(taxPlanDue("2028-06-01", false, "2026-10-19")).toBe(false);
  });
});

describe("whether to refinance", () => {
  const offer = { lender: "Maple Student Refi", aprBps: 449, savingCents: 210_000 };
  it("never refinances a federal loan away from PSLF", () => {
    const g = refiGuide({ loanType: "federal", publicService: true, currentAprBps: 525, offer });
    expect(g.verdict).toBe("keep");
    expect(g.lost).toEqual([...FEDERAL_PROTECTIONS]);
    expect(g.text).toContain("Don't refinance a federal loan");
  });
  it("says what a federal loan loses even when the offer is good", () => {
    const g = refiGuide({ loanType: "federal", publicService: false, currentAprBps: 650, offer });
    expect(g.verdict).toBe("weigh");
    expect(g.text).toContain("permanent and gives up");
    expect(g.lost.length).toBeGreaterThan(0);
  });
  it("keeps a federal loan when the offer isn't well below its rate", () => {
    const g = refiGuide({
      loanType: "federal",
      publicService: false,
      currentAprBps: 525,
      offer: { ...offer, aprBps: 480 },
    });
    expect(g.verdict).toBe("keep");
    expect(g.text).not.toContain("would save");
  });
  it("considers refinancing a private loan only for a rate a point lower that saves money", () => {
    expect(
      refiGuide({ loanType: "private", publicService: false, currentAprBps: 650, offer }).verdict,
    ).toBe("consider");
    expect(
      refiGuide({ loanType: "private", publicService: false, currentAprBps: 500, offer }).verdict,
    ).toBe("keep");
    expect(
      refiGuide({ loanType: "private", publicService: false, currentAprBps: 650, offer: null })
        .verdict,
    ).toBe("keep");
    expect(
      refiGuide({ loanType: "private", publicService: false, currentAprBps: 650, offer }).lost,
    ).toEqual([]);
  });
});
