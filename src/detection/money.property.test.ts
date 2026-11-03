import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASSUMED_CURRENT_RATE_BPS,
  CHARGES_PER_YEAR,
  REFERENCE_HIGH_YIELD_RATE_BPS,
} from "@/config/detection";
import { kindOf, spendingInsights, type InsightTransaction } from "@/insights/spending";
import { derivedBalances } from "@/lib/import/balances";
import { detect } from "./detect";
import type { Candidate, DetectionInput, DetectionTransaction, EvidenceTransaction } from "./types";
import { addDays } from "./units";

// What has to hold for anyone's money, whatever their rows: every finding's dollars come from its
// own transactions, and money moved between someone's own accounts is neither spending nor income
// and leaves what they're worth alone. Rows are made up, in shapes the rules act on.

const AS_OF = "2026-10-30";
const CHECKING = {
  id: "checking",
  name: "Checking",
  type: "depository",
  subtype: "checking",
};
const SAVINGS = { id: "savings", name: "Savings", type: "depository", subtype: "savings" };
const CARD = { id: "card", name: "Card", type: "credit", subtype: "credit card" };

const SUBSCRIPTIONS = ["NETFLIX.COM", "SPOTIFY USA", "HULU", "DISNEY PLUS", "THE GYM CLUB"];
const SHOPS = ["CORNER BAKERY", "SHELL OIL", "TRADER JOES", "TARGET", "BEST BUY"];
const cents = (min: number, max: number) => fc.integer({ min, max });

let nextId = 0;
const row = (
  accountId: string,
  date: string,
  amountCents: number,
  description: string,
  pfcPrimary: string | null,
  pfcDetailed: string | null,
): DetectionTransaction => ({
  id: `t${(nextId += 1)}`,
  accountId,
  plaidTransactionId: null,
  date,
  amountCents,
  description,
  merchantName: null,
  pfcPrimary,
  pfcDetailed,
  categorySource: "rule",
});

// Monthly charges back from about today, at one price and possibly a higher one lately.
const subscription = fc
  .record({
    name: fc.constantFrom(...SUBSCRIPTIONS),
    months: cents(2, 14),
    price: cents(300, 4000),
    rise: fc.option(cents(50, 1500), { nil: undefined }),
    risenFor: cents(1, 3),
    account: fc.constantFrom("checking", "card"),
    day: cents(1, 28),
  })
  .map(({ name, months, price, rise, risenFor, account, day }) =>
    Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9 - i, day)).toISOString().slice(0, 10);
      const amount = rise !== undefined && i < risenFor ? price + rise : price;
      return row(account, d, amount, name, "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES");
    }),
  );

const fees = fc
  .array(cents(100, 4500), { minLength: 1, maxLength: 6 })
  .chain((amounts) =>
    fc
      .array(cents(1, 300), { minLength: amounts.length, maxLength: amounts.length })
      .map((days) =>
        amounts.map((a, i) =>
          row(
            "checking",
            addDays(AS_OF, -days[i]!),
            a,
            "OVERDRAFT FEE",
            "BANK_FEES",
            "BANK_FEES_OVERDRAFT_FEES",
          ),
        ),
      ),
  );

// A card's annual fee beside other fees and refunds of them, which come back at any size.
const annualFee = fc
  .record({
    annual: cents(1000, 69500),
    others: fc.array(cents(100, 4000), { maxLength: 4 }),
    back: fc.array(cents(100, 20000), { maxLength: 2 }),
    days: cents(1, 80),
  })
  .map(({ annual, others, back, days }) => {
    const on = (amount: number, description: string, i: number) =>
      row(
        "card",
        addDays(AS_OF, -((days + i) % 85) - 1),
        amount,
        description,
        "BANK_FEES",
        "BANK_FEES_OTHER_BANK_FEES",
      );
    return [
      on(annual, "ANNUAL MEMBERSHIP FEE", 0),
      ...others.map((c, i) => on(c, "LATE FEE", i + 1)),
      ...back.map((c, i) => on(-c, "FEE REFUND", i + 7)),
    ];
  });

const interest = fc
  .array(fc.tuple(cents(100, 9000), cents(1, 300)), { minLength: 1, maxLength: 6 })
  .map((items) =>
    items.map(([a, days]) =>
      row(
        "card",
        addDays(AS_OF, -days),
        a,
        "INTEREST CHARGE",
        "BANK_FEES",
        "BANK_FEES_INTEREST_CHARGE",
      ),
    ),
  );

// The same price at a shop twice within days, sometimes refunded.
const doubled = fc
  .record({ name: fc.constantFrom(...SHOPS), price: cents(500, 40000), back: cents(1, 60) })
  .map(({ name, price, back }) => {
    const day = addDays(AS_OF, -back);
    return [
      row("card", day, price, name, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OTHER"),
      row("card", addDays(day, 1), price, name, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OTHER"),
    ];
  });

const shopping = fc
  .array(
    fc.record({
      name: fc.constantFrom(...SHOPS),
      amount: cents(-3000, 30000),
      back: cents(1, 300),
    }),
    { maxLength: 30 },
  )
  .map((rows) =>
    rows
      .filter((r) => r.amount !== 0)
      .map((r) =>
        row(
          "card",
          addDays(AS_OF, -r.back),
          r.amount,
          r.name,
          "GENERAL_MERCHANDISE",
          "GENERAL_MERCHANDISE_OTHER",
        ),
      ),
  );

const person: fc.Arbitrary<DetectionInput> = fc
  .record({
    subscriptions: fc.array(subscription, { maxLength: 4 }),
    fees: fc.option(fees, { nil: undefined }),
    annualFee: fc.option(annualFee, { nil: undefined }),
    interest: fc.option(interest, { nil: undefined }),
    doubled: fc.array(doubled, { maxLength: 3 }),
    shopping,
    checking: cents(-50000, 5000000),
    savings: cents(0, 10000000),
    owed: fc.option(cents(0, 2000000), { nil: null }),
  })
  .map((p) => ({
    asOf: AS_OF,
    accounts: [
      { ...CHECKING, currentBalanceCents: p.checking },
      { ...SAVINGS, currentBalanceCents: p.savings },
      { ...CARD, currentBalanceCents: p.owed },
    ],
    transactions: [
      ...p.subscriptions.flat(),
      ...(p.fees ?? []),
      ...(p.annualFee ?? []),
      ...(p.interest ?? []),
      ...p.doubled.flat(),
      ...p.shopping,
    ],
    recurringStreams: [],
  }));

const sum = (rows: readonly { amountCents: number }[]) =>
  rows.reduce((total, r) => total + r.amountCents, 0);
const proof = (c: Candidate, field: string) =>
  c.evidence[field] as unknown as EvidenceTransaction[];

// Each rule's dollars, worked again from what the card shows as its proof.
function recompute(c: Candidate, input: DetectionInput): void {
  const label = `${c.type} ${c.key}`;
  switch (c.type) {
    case "bank_fees":
    case "card_interest": {
      const rows = proof(c, "transactions");
      expect(c.amountCents, label).toBe(sum(rows));
      expect(c.evidence.totalCents, label).toBe(sum(rows));
      expect(c.amountCents!, label).toBeGreaterThan(0);
      // A year's pace is never less than what was really charged.
      expect(c.annualSavingsCents!, label).toBeGreaterThanOrEqual(c.amountCents!);
      return;
    }
    case "duplicate_charge": {
      const [first, second] = proof(c, "charges");
      expect(c.amountCents, label).toBe(second!.amountCents);
      expect(c.annualSavingsCents, label).toBe(second!.amountCents);
      expect(c.evidence.refundCents, label).toBe(second!.amountCents);
      expect(first!.date <= second!.date, label).toBe(true);
      return;
    }
    case "charge_after_cancel": {
      expect(c.amountCents, label).toBe(sum(proof(c, "charges")));
      return;
    }
    case "trial_conversion": {
      expect(c.amountCents, label).toBe(proof(c, "charges")[1]!.amountCents);
      return;
    }
    case "subscription_review": {
      const charges = proof(c, "charges");
      expect(c.evidence.lastAmountCents, label).toBe(charges[charges.length - 1]!.amountCents);
      expect(c.amountCents, label).toBe(c.evidence.annualCostCents);
      return;
    }
    case "price_increase": {
      const charges = proof(c, "charges");
      const last = c.evidence.lastAmountCents as number;
      const prior = c.evidence.priorAverageCents as number;
      const perYear = CHARGES_PER_YEAR[c.evidence.frequency as keyof typeof CHARGES_PER_YEAR];
      expect(last, label).toBe(charges[charges.length - 1]!.amountCents);
      expect(c.amountCents, label).toBe((last - prior) * perYear);
      expect(c.amountCents!, label).toBeGreaterThan(0);
      return;
    }
    case "idle_cash": {
      const e = c.evidence as Record<string, number> & { accounts: unknown };
      const accounts = e.accounts as unknown as { id: string; balanceCents: number }[];
      expect(e.totalBalanceCents, label).toBe(
        accounts.reduce(
          (total, a) => total + input.accounts.find((x) => x.id === a.id)!.currentBalanceCents!,
          0,
        ),
      );
      expect(e.excessCents, label).toBe(e.totalBalanceCents! - e.cushionCents! - e.setAsideCents!);
      expect(c.amountCents, label).toBe(e.excessCents);
      expect(c.annualSavingsCents, label).toBe(
        Math.round(
          (e.excessCents! * (REFERENCE_HIGH_YIELD_RATE_BPS - ASSUMED_CURRENT_RATE_BPS)) / 10_000,
        ),
      );
      return;
    }
    default:
  }
}

describe("every finding, for anyone's rows", () => {
  it("has dollars that recompute from its own transactions", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(person, (input) => {
        for (const finding of detect(input)) {
          seen.add(finding.type);
          recompute(finding, input);
        }
      }),
      { numRuns: 200 },
    );
    // The rows have to reach each rule, or this says nothing about it.
    expect([...seen]).toEqual(
      expect.arrayContaining([
        "subscription_review",
        "price_increase",
        "bank_fees",
        "card_interest",
        "duplicate_charge",
        "idle_cash",
      ]),
    );
  });

  it("never says a fee saves less than what was charged, on a short history with refunds", () => {
    const seen = new Set<number>();
    fc.assert(
      fc.property(annualFee, (transactions) => {
        const input: DetectionInput = {
          asOf: AS_OF,
          accounts: [{ ...CARD, currentBalanceCents: 0 }],
          transactions,
          recurringStreams: [],
        };
        for (const finding of detect(input).filter((c) => c.type === "bank_fees")) {
          recompute(finding, input);
          seen.add(Math.sign(finding.annualSavingsCents!));
        }
      }),
      { numRuns: 300 },
    );
    expect([...seen]).toEqual([1]);
  });

  it("shows only transactions the person has, at their real date and amount", () => {
    fc.assert(
      fc.property(person, (input) => {
        const byId = new Map(input.transactions.map((t) => [t.id, t]));
        for (const finding of detect(input)) {
          for (const field of ["charges", "transactions"]) {
            for (const shown of (finding.evidence[field] ??
              []) as unknown as EvidenceTransaction[]) {
              const real = byId.get(shown.id);
              expect(real, `${finding.type} shows ${shown.id}`).toBeDefined();
              expect(shown.amountCents).toBe(real!.amountCents);
              expect(shown.date).toBe(real!.date);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("is the same whatever order the rows come in", () => {
    fc.assert(
      fc.property(person, fc.integer(), (input, seed) => {
        const shuffled = [...input.transactions].sort(
          (a, b) =>
            (Math.imul(seed ^ Number(a.id.slice(1)), 2654435761) >>> 0) -
            (Math.imul(seed ^ Number(b.id.slice(1)), 2654435761) >>> 0),
        );
        const dollars = (rows: DetectionInput["transactions"]) =>
          detect({ ...input, transactions: rows })
            .map((c) => [c.type, c.key, c.amountCents, c.annualSavingsCents])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        expect(dollars(shuffled)).toEqual(dollars(input.transactions));
      }),
      { numRuns: 60 },
    );
  });
});

// A move between two of the person's own accounts, each side categorized as the rules do.
const insight = (
  date: string,
  amountCents: number,
  pfcPrimary: string,
  pfcDetailed: string,
): InsightTransaction => ({
  date,
  amountCents,
  description: "TRANSFER",
  merchantName: null,
  pfcPrimary,
  pfcDetailed,
  pending: false,
});
const ownMove = fc
  .record({
    cents: cents(1, 5000000),
    back: cents(0, 300),
    loan: fc.boolean(),
  })
  .map(({ cents: amount, back, loan }) => {
    const date = addDays(AS_OF, -back);
    return loan
      ? [
          insight(date, amount, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
          insight(date, -amount, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
        ]
      : [
          insight(date, amount, "TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"),
          insight(date, -amount, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER"),
        ];
  });

const someSpending = fc.array(
  fc.record({ amount: cents(-20000, 90000), back: cents(0, 300), income: fc.boolean() }),
  { maxLength: 40 },
);

const insightsOf = (rows: InsightTransaction[]) =>
  spendingInsights(rows, { asOf: AS_OF, monthCount: 12 });

describe("money moved between someone's own accounts", () => {
  it("nets to zero and is never spending or income", () => {
    fc.assert(
      fc.property(ownMove, (pair) => {
        expect(pair[0]!.amountCents + pair[1]!.amountCents).toBe(0);
        expect(pair.map(kindOf)).toEqual(["ignored", "ignored"]);
      }),
    );
  });

  it("changes no month's spending or income, whatever else happened", () => {
    fc.assert(
      fc.property(someSpending, fc.array(ownMove, { maxLength: 8 }), (rows, moves) => {
        const base = rows
          .filter((r) => r.amount !== 0)
          .map((r) =>
            r.income
              ? insight(addDays(AS_OF, -r.back), -Math.abs(r.amount), "INCOME", "INCOME_WAGES")
              : insight(
                  addDays(AS_OF, -r.back),
                  r.amount,
                  "GENERAL_MERCHANDISE",
                  "GENERAL_MERCHANDISE_OTHER",
                ),
          );
        expect(insightsOf([...base, ...moves.flat()]).months).toEqual(insightsOf(base).months);
      }),
    );
  });

  it("leaves net worth alone on every day, between banks or paying a card", () => {
    fc.assert(
      fc.property(
        fc.record({
          amount: cents(1, 500000),
          back: cents(1, 200),
          toCard: fc.boolean(),
          from: cents(-100000, 5000000),
          to: cents(0, 5000000),
          other: fc.array(fc.tuple(cents(-50000, 50000), cents(1, 200)), { maxLength: 10 }),
        }),
        ({ amount, back, toCard, from, to, other }) => {
          const date = addDays(AS_OF, -back);
          const fromType = "depository";
          const toType = toCard ? "credit" : "depository";
          const netWorthOf = (
            fromRows: { date: string; amountCents: number }[],
            toRows: { date: string; amountCents: number }[],
          ) => {
            const a = derivedBalances(fromType, from, fromRows, AS_OF);
            const b = derivedBalances(toType, to, toRows, AS_OF);
            const owed = (day: string) => {
              const at = [...b].reverse().find((x) => x.date <= day) ?? b[0]!;
              return toCard ? -at.balanceCents : at.balanceCents;
            };
            return a.map((x) => [x.date, x.balanceCents + owed(x.date)] as const);
          };
          const rows = other.map(([amountCents, days]) => ({
            date: addDays(AS_OF, -days),
            amountCents,
          }));
          const moved = netWorthOf(
            [...rows, { date, amountCents: amount }],
            [{ date, amountCents: -amount }],
          );
          // Before the move and after it, the two together are worth the same: only the other rows
          // change what they were worth.
          const today = from + (toCard ? -to : to);
          for (const [day, worth] of moved) {
            const later = rows
              .filter((r) => r.date > day)
              .reduce((total, r) => total + r.amountCents, 0);
            expect(worth, day).toBe(today + later);
          }
        },
      ),
    );
  });
});

describe("a month's spending", () => {
  it("is what its categories and refunds add up to, and never below zero", () => {
    fc.assert(
      fc.property(someSpending, (rows) => {
        const result = insightsOf(
          rows
            .filter((r) => r.amount !== 0)
            .map((r) =>
              insight(
                addDays(AS_OF, -r.back),
                r.amount,
                r.income ? "FOOD_AND_DRINK" : "GENERAL_MERCHANDISE",
                r.income ? "FOOD_AND_DRINK_GROCERIES" : "GENERAL_MERCHANDISE_OTHER",
              ),
            ),
        );
        for (const { month, spendingCents } of result.months) {
          const bought = result.categoriesByMonth[month]!.reduce((t, c) => t + c.cents, 0);
          const back = result.refundsByMonth[month]!.reduce((t, c) => t + c.cents, 0);
          expect(spendingCents).toBe(Math.max(0, bought + back));
          expect(spendingCents).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});
