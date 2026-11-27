import { describe, expect, it } from "vitest";
import { debtBook } from "@/insights/debts";
import type { Payoff } from "@/lib/debt-plan";
import { payoffSummary } from "@/planning/payoff";
import { payoffReply } from "./debt-replies";

// Debugger 11-17 (r327, Plaid sandbox checking and one federal student loan, chat on a phone):
// "what if I paid $100 more a month on my student loan?" answered "here's how two common orders
// would go: - Highest rate first: debt-free by January 2041 … - Smallest balance first:
// debt-free by January 2041 …", the same line twice, with a button for each. With one debt the
// order doesn't matter: one outcome, one button.

const ASOF = "2026-11-17";
const book = debtBook(
  {
    accounts: [],
    plans: [],
    typed: [
      {
        debtKey: "paid:student:nelnet",
        aprBps: 550,
        minimumPaymentCents: null,
        balanceCents: 1_468_810,
        payoffDate: null,
        updatedOn: ASOF,
      },
    ],
    paid: [
      {
        key: "student:nelnet",
        lender: "Nelnet",
        kind: "student",
        paymentCents: 2_500,
        paymentsMade: 3,
        lastDate: "2026-11-01",
        nextDate: "2026-12-01",
      },
    ],
  },
  ASOF,
);
const payoff = (advice: boolean): Payoff => ({
  advice,
  book,
  summary: payoffSummary(book.debts, { extraCents: 10_000, advice }),
  debtFreeMonth: null,
  stored: null,
});

describe("paying off one debt, in the chat", () => {
  it("gives one outcome, not two orders", () => {
    const reply = payoffReply(payoff(false), ASOF);
    expect(reply.body).not.toContain("two common orders");
    expect(reply.body.split("\n")[0]).toMatch(
      /^Paying \$125\.00 a month \(your minimums plus \$100\.00 extra\), you'd be debt-free by /,
    );
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Track this plan",
      "Open the payoff planner",
    ]);
  });

  // Walk of 11-27: "..., you'd be it doesn't finish within 50 years." Both forms are sentences.
  it("says a plan that never ends as its own sentence, not after 'you'd be'", () => {
    const never = (advice: boolean): Payoff => ({
      ...payoff(advice),
      summary: payoffSummary(book.debts, { extraCents: 0, advice }),
    });
    for (const advice of [false, true]) {
      const first = payoffReply(never(advice), ASOF).body.split("\n")[0];
      expect(first).toBe(
        "Paying $25.00 a month (your minimums), it doesn't finish within 50 years.",
      );
    }
    expect(payoffReply(payoff(false), ASOF).body.split("\n")[0]).toMatch(
      /, you'd be debt-free by .*\.$/,
    );
  });

  it("still sets two orders side by side for two debts", () => {
    const two = debtBook(
      {
        accounts: [],
        plans: [],
        typed: [
          {
            debtKey: "paid:student:nelnet",
            aprBps: 550,
            minimumPaymentCents: null,
            balanceCents: 1_468_810,
            payoffDate: null,
            updatedOn: ASOF,
          },
          {
            debtKey: "paid:auto:toyota",
            aprBps: 690,
            minimumPaymentCents: null,
            balanceCents: 900_000,
            payoffDate: null,
            updatedOn: ASOF,
          },
        ],
        paid: [
          {
            key: "student:nelnet",
            lender: "Nelnet",
            kind: "student",
            paymentCents: 2_500,
            paymentsMade: 3,
            lastDate: "2026-11-01",
            nextDate: "2026-12-01",
          },
          {
            key: "auto:toyota",
            lender: "Toyota",
            kind: "auto",
            paymentCents: 33_812,
            paymentsMade: 3,
            lastDate: "2026-11-07",
            nextDate: "2026-12-07",
          },
        ],
      },
      ASOF,
    );
    const reply = payoffReply(
      {
        advice: false,
        book: two,
        summary: payoffSummary(two.debts, { extraCents: 10_000, advice: false }),
        debtFreeMonth: null,
        stored: null,
      },
      ASOF,
    );
    expect(reply.body).toContain("here's how two common orders would go");
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Track highest rate first",
      "Track smallest balance first",
      "Open the payoff planner",
    ]);
  });

  it("has no order to pick in demo advice either", () => {
    const reply = payoffReply(payoff(true), ASOF);
    expect(reply.body).not.toMatch(/Here's how I'd pay them off|^1\. /m);
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Start this plan",
      "Open the payoff planner",
    ]);
  });
});
