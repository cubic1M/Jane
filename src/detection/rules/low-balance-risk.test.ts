import { describe, expect, it } from "vitest";
import { CHECKING, GEICO, input, monthsAgo, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { lowBalanceRisk } from "./low-balance-risk";
import { ACCOUNT_KINDS } from "@/data-sources/types";

const run = (data: DetectionInput) => lowBalanceRisk(data, buildStreams(data));
// Geico on the 1st of each month, so the next bill (Nov 1) is inside the window.
const geico = [3, 2, 1, 0].map((m) => tx({ ...GEICO, date: monthsAgo(m, 1), amountCents: 9_800 }));
const withBalance = (cents: number) =>
  input({
    accounts: [{ ...CHECKING, currentBalanceCents: cents }],
    transactions: geico,
  });

// Debugger 11-02: a freelancer with about $3,000 a month of payouts read "Short $1,991" and "could
// drop to -$1,990.78, 75% sure": payouts of uneven size and timing aren't a schedule, so the forecast
// counted no pay at all, and said nothing about it.
const payouts = [
  [2, 6, 184_500],
  [2, 20, 92_000],
  [1, 11, 240_000],
  [1, 29, 61_500],
  [0, 8, 315_000],
] as const;
const uneven = (cents: number, rows: readonly (readonly [number, number, number])[] = payouts) =>
  input({
    accounts: [{ ...CHECKING, currentBalanceCents: cents }],
    transactions: [
      ...geico,
      ...rows.map(([months, day, amount]) =>
        tx({
          date: monthsAgo(months, day),
          amountCents: -amount,
          description: "STRIPE TRANSFER",
          merchantName: "Stripe",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_OTHER",
        }),
      ),
    ],
  });

describe("a low balance for someone paid at uneven times", () => {
  it("says it counts no pay, what has been coming in, and isn't sure", () => {
    const [finding] = run(uneven(5_000));
    expect(finding.title).toBe(
      "Everyday Checking could drop to -$48.00 around Nov 1 if no pay comes in",
    );
    expect(finding.confidence).toBe("low");
    expect(finding.evidence.unevenPayMonthlyCents).toBe(Math.round(893_000 / 3));
  });

  it("stays as it was with no pay at all coming in", () => {
    const [finding] = run(uneven(5_000, []));
    expect(finding.title).toBe("Everyday Checking could drop to -$48.00 around Nov 1");
    expect(finding.confidence).toBe("high");
    expect(finding.evidence.unevenPayMonthlyCents).toBeUndefined();
  });

  it("doesn't count interest as pay", () => {
    const interest = uneven(5_000, []);
    interest.transactions.push(
      ...[2, 1, 0].map((months) =>
        tx({
          date: monthsAgo(months, 28),
          amountCents: -60_000,
          description: "INTEREST PAID",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_INTEREST_EARNED",
        }),
      ),
    );
    expect(run(interest)[0].evidence.unevenPayMonthlyCents).toBeUndefined();
  });
});

describe("low_balance_risk", () => {
  it("flags a checking account a bill takes below the cushion", () => {
    const [finding] = run(withBalance(15_000));

    expect(finding).toMatchObject({
      type: "low_balance_risk",
      key: "account:acct_checking",
      annualSavingsCents: null,
      amountCents: 5_200,
      confidence: "medium",
    });
    expect(finding.evidence).toMatchObject({ lowestCents: 5_200, lowestDate: "2026-11-01" });
    expect(finding.title).toBe("Everyday Checking could drop to $52.00 around Nov 1");
    expect((finding.evidence.bills as unknown[]).length).toBe(1);
  });

  it("is high confidence when the balance would go negative", () => {
    expect(run(withBalance(5_000))[0].confidence).toBe("high");
  });

  it("finds nothing with enough cushion, or with no balance on file", () => {
    expect(run(withBalance(50_000))).toEqual([]);
    expect(
      run(
        input({
          accounts: [{ ...CHECKING, currentBalanceCents: null }],
          transactions: geico,
        }),
      ),
    ).toEqual([]);
  });

  it("leaves a payment app alone: Venmo and PayPal top up from the bank behind them", () => {
    const wallet = { ...CHECKING, name: "PayPal", subtype: ACCOUNT_KINDS.payment_app.subtype };
    expect(
      run(input({ accounts: [{ ...wallet, currentBalanceCents: 1_500 }], transactions: geico })),
    ).toEqual([]);
  });
});
