import { describe, expect, it } from "vitest";
import {
  nextStatementClose,
  onTimeStreak,
  simulations,
  statementAmount,
  statementPlan,
  thinFile,
} from "./credit-building";

describe("when a card's statement closes", () => {
  it("steps a month at a time from the last one, keeping short months in range", () => {
    expect(nextStatementClose("2026-10-01", "2026-10-19")).toBe("2026-11-01");
    expect(nextStatementClose("2026-01-31", "2026-02-10")).toBe("2026-02-28");
    expect(nextStatementClose("2026-10-01", "2026-12-05")).toBe("2027-01-01");
  });

  it("plans a payment two days before, due within six days of closing", () => {
    const plan = statementPlan({
      lastIssue: "2026-10-01",
      asOf: "2026-10-28",
      balanceCents: 241_050,
      limitCents: 800_000,
    })!;
    expect(plan.closesOn).toBe("2026-11-01");
    expect(plan.payOn).toBe("2026-10-30");
    expect(plan.due).toBe(true);
    // 30% of $8,000 is $2,400: $2,410.50 is $10.50 over; 10% is $800.
    expect(plan.toUnderHighCents).toBe(1_050);
    expect(plan.toUnderGoodCents).toBe(161_050);
    expect(
      statementPlan({
        lastIssue: "2026-10-01",
        asOf: "2026-10-10",
        balanceCents: 1,
        limitCents: 1,
      })!.due,
    ).toBe(false);
    expect(
      statementPlan({
        lastIssue: "2026-10-01",
        asOf: "2026-10-10",
        balanceCents: 1,
        limitCents: 0,
      }),
    ).toBeNull();
  });

  it("never plans a payment in the past", () => {
    const plan = statementPlan({
      lastIssue: "2026-10-01",
      asOf: "2026-10-31",
      balanceCents: 500_000,
      limitCents: 800_000,
    })!;
    expect(plan.payOn).toBe("2026-10-31");
  });

  it("pays to under 10% when checking can spare it, else under 30%, else nothing", () => {
    const plan = statementPlan({
      lastIssue: "2026-10-01",
      asOf: "2026-10-28",
      balanceCents: 241_050,
      limitCents: 800_000,
    })!;
    expect(statementAmount(plan, 500_000)).toEqual({ amountCents: 161_050, target: "good" });
    expect(statementAmount(plan, 50_000)).toEqual({ amountCents: 1_050, target: "high" });
    expect(statementAmount(plan, 500)).toBeNull();
    const low = statementPlan({
      lastIssue: "2026-10-01",
      asOf: "2026-10-28",
      balanceCents: 50_000,
      limitCents: 800_000,
    })!;
    expect(statementAmount(low, 500_000)).toBeNull();
  });
});

describe("the on-time streak", () => {
  it("counts whole months since the last late fee, with milestones", () => {
    const s = onTimeStreak(["2026-03-20"], false, "2026-10-19", "2025-10-19");
    expect(s).toMatchObject({ months: 6, since: "2026-03-20", clean: false, milestone: 6 });
  });
  it("counts everything Jane can see when there's no late fee", () => {
    expect(onTimeStreak([], false, "2026-10-19", "2026-01-19")).toMatchObject({
      months: 9,
      clean: true,
      milestone: 6,
    });
    expect(onTimeStreak([], false, "2026-10-19", "2026-09-01").milestone).toBeNull();
  });
  it("starts again from zero while something is overdue", () => {
    expect(onTimeStreak([], true, "2026-10-19", "2025-10-19")).toMatchObject({
      months: 0,
      milestone: null,
    });
  });
});

describe("thin files and the simulator", () => {
  it("calls a file thin with few accounts or young ones", () => {
    expect(thinFile(2, 90)).toBe(true);
    expect(thinFile(4, 12)).toBe(true);
    expect(thinFile(4, 86)).toBe(false);
  });

  it("tries only changes that change something", () => {
    const request = {
      cardBalanceCents: 241_050,
      overdue: false,
      lateFeesLastYear: 1,
      hasInstallmentLoan: false,
      month: "2026-10",
    };
    const keys = simulations(request, 800_000, { thin: true }).map((s) => s.key);
    expect(keys).toEqual([
      "pay_to_30",
      "pay_to_10",
      "pay_off_cards",
      "on_time_year",
      "new_card",
      "builder_loan",
    ]);
    const clean = simulations({ ...request, cardBalanceCents: 0, lateFeesLastYear: 0 }, 800_000, {
      thin: false,
    }).map((s) => s.key);
    expect(clean).toEqual(["new_card"]);
  });
});
