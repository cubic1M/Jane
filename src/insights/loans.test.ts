import { describe, expect, it } from "vitest";
import { debtSummary, type DebtAccount } from "./loans";
import { formatRate } from "@/lib/percent";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

const account = (overrides: Partial<DebtAccount> = {}): DebtAccount => ({
  id: "a1",
  name: "Card",
  mask: null,
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 41_050,
  liability: null,
  ...overrides,
});

const details = (overrides: Partial<NonNullable<DebtAccount["liability"]>> = {}) => ({
  aprBps: null,
  rateType: null,
  minimumPaymentCents: null,
  nextPaymentDueDate: null,
  payoffDate: null,
  isOverdue: null,
  pastDueCents: null,
  ytdInterestPaidCents: null,
  description: null,
  ...overrides,
});

describe("loans and cards", () => {
  it("lists cards and loans only, with what the bank reports", () => {
    const summary = debtSummary(
      [
        account({ id: "checking", type: "depository", subtype: "checking" }),
        account({
          id: "home",
          name: "Home loan",
          mask: "1234",
          type: "loan",
          subtype: "mortgage",
          currentBalanceCents: 5_630_206,
          liability: details({
            aprBps: 399,
            rateType: "fixed",
            minimumPaymentCents: 314_154,
            nextPaymentDueDate: day("2026-11-01"),
            payoffDate: day("2045-07-31"),
            description: "conventional",
          }),
        }),
        account({ liability: details({ aprBps: 2299, minimumPaymentCents: 3500 }) }),
      ],
      "2026-10-18",
    );
    expect(summary.lines.map((l) => l.id)).toEqual(["home", "a1"]);
    expect(summary.lines[0]).toMatchObject({
      name: "Home loan ····1234",
      kindLabel: "Mortgage",
      aprBps: 399,
      monthlyCents: 314_154,
      nextDue: "2026-11-01",
      dueSoon: false,
      payoffDate: "2045-07-31",
    });
    expect(summary.totalOwedCents).toBe(5_630_206 + 41_050);
    expect(summary.totalMonthlyCents).toBe(314_154 + 3500);
    expect(summary.missingMonthly).toBe(0);
  });

  it("puts overdue first, then the soonest due, and marks what's due within a week", () => {
    const summary = debtSummary(
      [
        account({
          id: "later",
          name: "B",
          liability: details({ nextPaymentDueDate: day("2026-12-01") }),
        }),
        account({
          id: "soon",
          name: "C",
          liability: details({ nextPaymentDueDate: day("2026-10-20") }),
        }),
        account({
          id: "late",
          name: "D",
          type: "loan",
          subtype: "student",
          liability: details({ isOverdue: true, nextPaymentDueDate: day("2026-12-15") }),
        }),
        account({ id: "none", name: "A" }),
      ],
      "2026-10-18",
    );
    expect(summary.lines.map((l) => l.id)).toEqual(["late", "soon", "later", "none"]);
    expect(summary.lines.find((l) => l.id === "soon")?.dueSoon).toBe(true);
    expect(summary.lines.find((l) => l.id === "later")?.dueSoon).toBe(false);
    expect(summary.lines[0]).toMatchObject({ overdue: true, kindLabel: "Student loan" });
  });

  it("leaves out a description the name already gives", () => {
    const [line] = debtSummary(
      [
        account({
          name: "Consolidation loan",
          type: "loan",
          subtype: "student",
          liability: details({ description: "Consolidation" }),
        }),
      ],
      "2026-10-18",
    ).lines;
    expect(line.description).toBeNull();
  });

  it("estimates nothing: missing details stay missing and are counted", () => {
    const summary = debtSummary(
      [account({ currentBalanceCents: -500 }), account({ id: "b", currentBalanceCents: null })],
      "2026-10-18",
    );
    expect(summary.lines.map((l) => [l.balanceCents, l.aprBps, l.monthlyCents])).toEqual([
      [0, null, null],
      [null, null, null],
    ]);
    expect(summary.totalOwedCents).toBe(0);
    expect(summary.missingMonthly).toBe(2);
  });

  it("formats rates", () => {
    expect(formatRate(2499)).toBe("24.99%");
    expect(formatRate(399)).toBe("3.99%");
  });
});
