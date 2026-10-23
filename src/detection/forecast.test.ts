import { describe, expect, it } from "vitest";
import {
  CHECKING,
  GEICO,
  NETFLIX,
  input,
  monthly,
  monthsAgo,
  plaidStream,
  tx,
} from "./__fixtures__/build";
import { expectedDates, forecastAccounts, incomeStreams, upcomingBills } from "./forecast";
import { buildStreams } from "./streams";

const PAY = {
  description: "ACME CORP PAYROLL",
  merchantName: "Acme Corp",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_SALARY",
};
// Paid on the 1st, as negative (money in) amounts.
const paychecks = (amounts: number[]) =>
  amounts.map((a, i) =>
    tx({ ...PAY, date: monthsAgo(amounts.length - 1 - i, 1), amountCents: -a }),
  );

describe("upcomingBills", () => {
  it("expands each active stream across the window", () => {
    const bills = upcomingBills(input({ transactions: monthly(4, 1549, NETFLIX) }), 61);

    expect(bills.map((b) => [b.merchant, b.date, b.amountCents])).toEqual([
      ["Netflix", "2026-11-15", 1549],
      ["Netflix", "2026-12-15", 1549],
    ]);
  });

  it("prefers Plaid's predicted next date", () => {
    const [stream] = buildStreams(
      input({
        recurringStreams: [
          plaidStream({ lastDate: "2026-09-30", predictedNextDate: "2026-10-28" }),
        ],
      }),
    );

    expect(expectedDates(stream, "2026-10-15", "2026-11-30")).toEqual(["2026-10-28", "2026-11-28"]);
  });
});

describe("upcomingBills, as the person reads them (books QA)", () => {
  it("names a card payment by what it is, and leaves card interest out", () => {
    const bills = upcomingBills(
      input({
        transactions: [
          ...monthly(4, 1549, NETFLIX),
          ...monthly(4, 9000, {
            description: "CARD PAYMENT THANK YOU",
            merchantName: null,
            pfcPrimary: "LOAN_PAYMENTS",
            pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          }),
          ...monthly(4, 4640, {
            description: "INTEREST CHARGE",
            merchantName: null,
            pfcPrimary: "BANK_FEES",
            pfcDetailed: "BANK_FEES_INTEREST_CHARGE",
          }),
        ],
      }),
      31,
    );
    expect(bills.map((b) => b.merchant).sort()).toEqual(["Credit card payment", "Netflix"]);
  });
});

describe("incomeStreams", () => {
  it("finds recurring pay, even when the amount varies a little", () => {
    const [pay] = incomeStreams(
      input({ transactions: paychecks([300_000, 310_000, 295_000, 305_000]) }),
    );

    expect(pay).toMatchObject({
      merchant: "Acme Corp",
      frequency: "MONTHLY",
      lastAmountCents: 305_000,
    });
  });

  it("ignores irregular deposits", () => {
    const odd = [
      tx({ ...PAY, date: "2026-06-03", amountCents: -50_000 }),
      tx({ ...PAY, date: "2026-09-21", amountCents: -120_000 }),
    ];
    expect(incomeStreams(input({ transactions: odd }))).toEqual([]);
  });
});

describe("forecastAccounts", () => {
  it("walks the checking balance down with bills and up with pay", () => {
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }],
      transactions: [
        ...monthly(4, 9_800, GEICO),
        ...paychecks([300_000, 300_000, 300_000, 300_000]),
      ],
    });

    const [f] = forecastAccounts(data, 31);

    expect(f.startCents).toBe(20_000);
    // Pay on the 1st, Geico on the 15th: both keep their day of the month.
    expect(f.income.map((i) => i.date)).toEqual(["2026-11-01"]);
    expect(f.bills.map((b) => b.date)).toEqual(["2026-11-15"]);
    expect(f.days.at(-1)?.balanceCents).toBe(20_000 + 300_000 - 9_800);
    expect(f.lowest).toEqual({ date: "2026-10-15", balanceCents: 20_000 });
  });

  it("skips accounts without a balance and non-checking accounts", () => {
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: null }],
      transactions: monthly(4, 1549, NETFLIX),
    });
    expect(forecastAccounts(data, 30)).toEqual([]);
  });
});
