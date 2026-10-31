import { describe, expect, it } from "vitest";
import {
  AS_OF,
  CARD,
  CHECKING,
  GEICO,
  NETFLIX,
  input,
  monthly,
  monthsAgo,
  plaidStream,
  tx,
} from "./__fixtures__/build";
import {
  billName,
  expectedDates,
  forecastAccounts,
  incomeStreams,
  upcomingBills,
} from "./forecast";
import { addDays } from "./units";
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
  // CSV bench, second tuning set.
  it("lists a meal kit every week, which is a plan, not a food habit", () => {
    const transactions = [0, 1, 2, 3, 4, 5].map((i) =>
      tx({
        description: "HELLOFRESH 646-846-3663",
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
        date: addDays(AS_OF, -7 * (5 - i) - 1),
        amountCents: 7499,
      }),
    );
    expect(upcomingBills(input({ transactions }), 31).length).toBeGreaterThan(0);
  });

  it("lists a water bill paid every quarter, seen twice", () => {
    const water = {
      description: "MILLBROOK WATER DEPT",
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed: "RENT_AND_UTILITIES_WATER",
    };
    const transactions = [
      tx({ ...water, date: addDays(AS_OF, -175), amountCents: 12_114 }),
      tx({ ...water, date: addDays(AS_OF, -84), amountCents: 11_213 }),
    ];
    expect(upcomingBills(input({ transactions }), 31)).toEqual([
      expect.objectContaining({ merchant: expect.stringMatching(/Millbrook/i) }),
    ]);
  });

  it("expands each active stream across the window", () => {
    const bills = upcomingBills(input({ transactions: monthly(4, 1549, NETFLIX) }), 61);

    expect(bills.map((b) => [b.merchant, b.date, b.amountCents])).toEqual([
      ["Netflix", "2026-11-15", 1549],
      ["Netflix", "2026-12-15", 1549],
    ]);
  });

  it("leaves out a coffee at one price every week: a habit, not a bill", () => {
    const coffee = Array.from({ length: 10 }, (_, i) =>
      tx({
        description: "STARBUCKS STORE 05423",
        merchantName: "Starbucks",
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_COFFEE",
        date: new Date(Date.parse("2026-10-14T00:00:00Z") - i * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        amountCents: 545,
      }),
    );
    const bills = upcomingBills(
      input({ transactions: [...coffee, ...monthly(4, 1549, NETFLIX)] }),
      31,
    );

    expect(bills.map((b) => b.merchant)).toEqual(["Netflix"]);
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

describe("upcomingBills, for cash (overnight upload QA)", () => {
  it("leaves out regular ATM withdrawals and their fees", () => {
    const bills = upcomingBills(
      input({
        transactions: [
          ...monthly(4, 1549, NETFLIX),
          ...monthly(4, 4000, {
            description: "ATM WITHDRAWAL",
            merchantName: "Atm Withdrawal",
            pfcPrimary: "TRANSFER_OUT",
            pfcDetailed: "TRANSFER_OUT_WITHDRAWAL",
          }),
          ...monthly(4, 300, {
            description: "NON-CHASE ATM FEE-WITH",
            merchantName: "Non-Chase Atm Fee-With",
            pfcPrimary: "BANK_FEES",
            pfcDetailed: "BANK_FEES_ATM_FEES",
          }),
        ],
      }),
      31,
    );
    expect(bills.map((b) => b.merchant)).toEqual(["Netflix"]);
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

  // Messy-bank QA: a monthly move to savings is no bill, but it still leaves checking.
  it("takes scheduled moves to savings out of checking without calling them bills", () => {
    const toSavings = {
      description: "Online Transfer to SAV ...4521 transaction#: 1234567",
      merchantName: null,
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    };
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }],
      transactions: [...monthly(4, 9_800, GEICO), ...monthly(4, 50_000, toSavings)],
    });

    expect(upcomingBills(data, 31).map((b) => b.merchant)).toEqual(["Geico"]);
    const [f] = forecastAccounts(data, 31);
    expect(f.bills.map((b) => b.merchant)).toEqual(["Geico"]);
    expect(f.days.at(-1)?.balanceCents).toBe(20_000 - 9_800 - 50_000);
  });

  // Debugger 10-30: a student pays the whole rent and the roommates' shares come back by a Venmo
  // cash-out every month. Moves out were in the forecast, moves in weren't, so it read "could
  // drop to -$2,718.80" and stayed there.
  it("brings regular moves in (a monthly Venmo cash-out) into checking too", () => {
    const cashOut = {
      description: "VENMO CASHOUT",
      merchantName: "Venmo",
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
    };
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }],
      transactions: [...monthly(4, 9_800, GEICO), ...monthly(4, -160_000, cashOut)],
    });

    const [f] = forecastAccounts(data, 31);
    expect(f.days.at(-1)?.balanceCents).toBe(20_000 - 9_800 + 160_000);
    expect(f.transfersIn.map((t) => t.date)).toEqual(["2026-11-15"]);
  });

  // Review 10-30: a paycheck the bank tags as a transfer in was expected twice, as pay and as a
  // move in ("ACME CORP PAYROLL" six months running: +$6,200 instead of +$3,200).
  it("doesn't expect a paycheck tagged as a transfer in twice", () => {
    const payTaggedTransfer = {
      description: "ACME CORP PAYROLL",
      merchantName: "Acme Corp",
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_OTHER_TRANSFER_IN",
    };
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }],
      transactions: [...monthly(4, 9_800, GEICO), ...monthly(6, -300_000, payTaggedTransfer)],
    });
    const [f] = forecastAccounts(data, 31);
    const inflows = f.income.length + f.transfersIn.length;
    expect(inflows).toBe(1);
    expect(f.days.at(-1)?.balanceCents).toBe(20_000 - 9_800 + 300_000);
  });

  // ...but a one-off move in (savings topped up once) isn't expected again.
  it("doesn't expect a one-off move in again", () => {
    const fromSavings = {
      description: "TRANSFER FROM SAV XXXXX7781",
      merchantName: null,
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_SAVINGS",
    };
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }],
      transactions: [
        ...monthly(4, 9_800, GEICO),
        tx({ ...fromSavings, date: monthsAgo(1), amountCents: -50_000 }),
      ],
    });
    const [f] = forecastAccounts(data, 31);
    expect(f.days.at(-1)?.balanceCents).toBe(20_000 - 9_800);
  });

  it("skips accounts without a balance and non-checking accounts", () => {
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: null }],
      transactions: monthly(4, 1549, NETFLIX),
    });
    expect(forecastAccounts(data, 30)).toEqual([]);
  });
});

// Overnight beta list: a card payment is named for its card, not "Credit card payment".
describe("billName for a card payment", () => {
  const cardPay = (description: string, accountId = CHECKING.id) =>
    monthly(4, 30_000, {
      accountId,
      description,
      merchantName: null,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    });
  const named = (description: string, accounts = [CHECKING], accountId = CHECKING.id) => {
    const bills = upcomingBills(
      input({ accounts, transactions: cardPay(description, accountId) }),
      31,
    );
    return bills.map((b) => b.merchant);
  };
  const SAPPHIRE = { ...CARD, id: "acct_sapphire", name: "Chase Sapphire" };
  const AMEX_GOLD = { ...CARD, id: "acct_gold", name: "Amex Gold" };

  it("names the card company the payment names", () => {
    expect(named("CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224")).toEqual(["Chase card payment"]);
    expect(named("AMEX EPAYMENT ACH PMT W4562")).toEqual(["American Express card payment"]);
    expect(named("CAPITAL ONE ONLINE PMT 9F2K")).toEqual(["Capital One card payment"]);
    expect(named("CITI AUTOPAY PAYMENT 4410")).toEqual(["Citi card payment"]);
  });

  it("names the person's own card of that company, short names too", () => {
    const cards = [CHECKING, SAPPHIRE, AMEX_GOLD];
    expect(named("CHASE CREDIT CRD AUTOPAY", cards)).toEqual(["Chase Sapphire payment"]);
    expect(named("AMERICAN EXPRESS ACH PMT", cards)).toEqual(["Amex Gold payment"]);
  });

  it("names the card a payment is on", () => {
    expect(named("PAYMENT THANK YOU", [CHECKING, SAPPHIRE], SAPPHIRE.id)).toEqual([
      "Chase Sapphire payment",
    ]);
  });

  it("doesn't guess a lone card for a company it doesn't know, or one it isn't", () => {
    expect(named("FNBO CARD PMT 2231", [CHECKING, SAPPHIRE])).toEqual(["Credit card payment"]);
    expect(named("DISCOVER E-PAYMENT 7731", [CHECKING, SAPPHIRE])).toEqual([
      "Discover card payment",
    ]);
  });

  it("leaves every other bill's name alone", () => {
    const [netflix] = buildStreams(input({ transactions: monthly(4, 1549, NETFLIX) }));
    expect(billName(netflix, [CHECKING, SAPPHIRE])).toBe(netflix.merchant);
  });
});

// Debugger 10-30: a Klarna Pay in 4 that had made its four payments was still "coming up" on
// Nov 11 and Nov 25. src/insights/bnpl.ts knows the plan ended; the bills forecast now asks it.
describe("upcomingBills, for buy now, pay later", () => {
  const KLARNA = {
    description: "KLARNA* NIKE.COM",
    merchantName: null,
    pfcPrimary: "LOAN_PAYMENTS",
    pfcDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT",
  };
  // Payments two weeks apart, the last one `lastDaysAgo` before AS_OF (Oct 15).
  const payIn4 = (made: number, lastDaysAgo: number) =>
    Array.from({ length: made }, (_, i) =>
      tx({
        ...KLARNA,
        date: addDays(AS_OF, -lastDaysAgo - 14 * (made - 1 - i)),
        amountCents: 3_249,
      }),
    );

  it("leaves out a Pay in 4 that has made its four payments", () => {
    const bills = upcomingBills(input({ transactions: payIn4(4, 1) }), 61);
    expect(bills.filter((b) => /klarna/i.test(b.merchant))).toEqual([]);
  });

  // Review 10-31: only a Pay in 4's cadence (every two weeks) ends this way.
  it("keeps a quarterly bill whose name only contains a plan company's", () => {
    const transactions = [-273, -182, -91].map((d) =>
      tx({
        description: "AFFIRM HEALTH QUARTERLY",
        merchantName: null,
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_INSURANCE",
        date: addDays(AS_OF, d + 10),
        amountCents: 30_000,
      }),
    );
    expect(upcomingBills(input({ transactions }), 31).map((b) => b.amountCents)).toEqual([30_000]);
  });

  it("keeps a monthly Affirm plan, whose end the payments don't show", () => {
    const transactions = [6, 5, 4, 3, 2, 1].map((m) =>
      tx({
        ...KLARNA,
        description: "AFFIRM * PAY 8XKQ",
        date: monthsAgo(m, 3),
        amountCents: 5_000,
      }),
    );
    expect(upcomingBills(input({ transactions }), 31).map((b) => b.date)).toEqual(["2026-11-03"]);
  });

  it("expects only the payment left on a Pay in 4 still running", () => {
    const bills = upcomingBills(input({ transactions: payIn4(3, 7) }), 61);
    expect(bills.filter((b) => /klarna/i.test(b.merchant)).map((b) => b.date)).toEqual([
      "2026-10-22",
    ]);
  });
});
