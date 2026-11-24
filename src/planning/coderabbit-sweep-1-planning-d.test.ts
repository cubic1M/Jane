import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { fitPersonFrom } from "./fit-person";
import { billPlan } from "./bill-pay";
import { payoffPlan } from "./debt";
import { reviewReason } from "./debt-review";
import { overdraft, savingsOrDebt, type DecisionInput } from "./debt-decisions";
import { loanBalance } from "./family-loans";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 3: each case is a finding
// reproduced against the code first (failing), then fixed.

const decision: DecisionInput = {
  advice: false,
  cards: [
    { name: "Small Card", balanceCents: 100_000, aprBps: 2_500, limitCents: 500_000 },
    { name: "Big Card", balanceCents: 900_000, aprBps: 500, limitCents: 1_000_000 },
  ],
  mortgage: null,
  student: null,
  liquidCents: 1_300_000,
  monthlySpendCents: 100_000,
  consolidation: null,
  personalLoan: null,
  nextPayday: null,
};

describe("savings or debt: the payment is spread by what each card owes", () => {
  it("$10,000 on a $1,000 card at 25% and a $9,000 card at 5% saves $700 a year, not $2,500", () => {
    // Cash $13,000, a $3,000 cushion: $10,000 spare, split $1,000 at 25% and $9,000 at 5%.
    const d = savingsOrDebt({ ...decision, cushionCents: 300_000 });
    expect(d.sentences[1]).toMatch(/saves about \$700\.00 a year/);
    expect(d.sentences[1]).toMatch(/on your cards, Small Card first/);
  });
});

describe("overdraft: the savings check and the transfer cover the deepest dip", () => {
  const forecast = (first: number, lowest: number, savingsCents: number) => ({
    ...decision,
    advice: true,
    forecast: {
      firstNegative: { date: "Nov 3", balanceCents: first },
      lowest: { date: "Nov 9", balanceCents: lowest },
      savingsCents,
    },
  });
  it("sizes the move by the lowest balance, and dates it by the first dip", () => {
    const d = overdraft(forecast(-1_000, -20_000, 50_000));
    expect(d.sentences[0]).toMatch(
      /\$10\.00 below zero on Nov 3, and as far as \$200\.00 below zero by Nov 9/,
    );
    expect(d.sentences[2]).toBe("Move $200.00 over before Nov 3 so no overdraft fee hits.");
  });
  it("is unchanged when the first dip is the deepest", () => {
    const d = overdraft(forecast(-21_180, -21_180, 50_000));
    expect(d.sentences[0]).toBe(
      "Yes: your checking is forecast to go $211.80 below zero on Nov 3.",
    );
  });
});

describe("family loans: a repayment on the day the loan opened", () => {
  const loan = {
    kind: "lent" as const,
    counterpartyKey: "sam",
    principalCents: 10_000,
    openedOn: "2026-11-01",
  };
  it("takes down the balance", () => {
    const transfers = [
      { id: "1", date: "2026-11-01", amountCents: 10_000, description: "Zelle payment to Sam" },
      { id: "2", date: "2026-11-01", amountCents: -4_000, description: "Zelle payment from Sam" },
    ];
    const out = loanBalance(loan, transfers as never);
    expect(out.balanceCents).toBe(6_000);
  });
});

describe("debt review: a raise is a raise", () => {
  it("does not return raise for unchanged zero pay", () => {
    const input = {
      keys: ["a"],
      lastKeys: ["a"],
      lastOn: "2026-06-01",
      today: "2026-11-24",
      anyOverdue: false,
      lastPayCents: 0,
      payCents: 0,
    };
    expect(reviewReason(input as never)).toBeNull();
  });
});

describe("payoff plan: a minimum is never more than the card can take", () => {
  it("clears a $10 zero-rate card on a $10 budget against a $25 minimum", () => {
    const plan = payoffPlan(
      [{ id: "c", name: "Card", balanceCents: 1_000, aprBps: 0, minimumCents: 2_500 }],
      1_000,
      "avalanche",
    );
    expect(plan.ok).toBe(true);
  });
});

describe("fit person: loan payments over the months the data covers", () => {
  it("does not divide one month of payments by three", () => {
    const d = {
      today: "2026-11-24",
      transactions: [
        {
          date: "2026-11-05",
          amountCents: 90_000,
          description: "PERSONAL LOAN PAYMENT",
          pfc: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
          accountId: "chk",
        },
        {
          date: "2026-11-01",
          amountCents: -300_000,
          description: "ACME CORP PAYROLL",
          pfc: "INCOME_SALARY",
          accountId: "chk",
        },
      ],
      accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 100_000 }],
      liabilities: [],
      told: {},
    } as ProfileInput;
    expect(buildProfile(d).months).toBe(1);
    expect(fitPersonFrom(d).debtPaymentsCents).toBe(90_000);
  });
});

describe("a bill due today is never scheduled after its due date", () => {
  const bill = {
    accountId: "c",
    name: "Card",
    kind: "card",
    dueOn: "2026-11-24",
    minimumCents: 5_000,
    balanceCents: 20_000,
    autopay: null,
  };
  const series = ["2026-11-24", "2026-11-25", "2026-12-03", "2026-12-05"].map((date) => ({
    date,
    balanceCents: 500_000,
  }));
  it("says late for a bill due today rather than a run date after it", () => {
    expect(billPlan(bill, series, "2026-11-24").status).toBe("late");
  });
  it("still schedules a bill due after the earliest run date, on or before it", () => {
    const plan = billPlan({ ...bill, dueOn: "2026-12-05" }, series, "2026-11-24");
    expect(plan.status).toBe("pay");
    if (plan.status === "pay") expect(plan.runOn <= "2026-12-05").toBe(true);
  });
});

describe("savings or debt: a card with no rate", () => {
  it("says what it prices and what it doesn't", () => {
    const d = savingsOrDebt({
      ...decision,
      cards: [
        { name: "Small Card", balanceCents: 100_000, aprBps: 2_500, limitCents: 500_000 },
        { name: "No Rate", balanceCents: 900_000, aprBps: null, limitCents: 1_000_000 },
      ],
      cushionCents: 300_000,
    });
    expect(d.sentences[1]).toMatch(
      /at the rates I know; the other \$9,000\.00 is on cards whose rate I don't have/,
    );
  });
});
