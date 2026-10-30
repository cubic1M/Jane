import { describe, expect, it } from "vitest";
import { DUPLICATE_CHARGE_MAX_PERCENT, UNUSUAL_EXPECTED_FOR_BUSINESS } from "@/config/detection";
import {
  AS_OF,
  CARD,
  CHECKING,
  GEICO,
  GROCERIES,
  NETFLIX,
  input,
  monthly,
  monthsAgo,
  sampleYear,
  tx,
} from "./__fixtures__/build";
import {
  billReminderAlerts,
  detectAlerts,
  dueReportedCategories,
  duplicateChargeAlerts,
  estimatedTaxAlerts,
  feeAlerts,
  largeChargeAlerts,
  lowBalanceAlerts,
  newSubscriptionAlerts,
  onePerCharge,
  priceIncreaseAlerts,
  type AlertCandidate,
  type AlertContext,
} from "./alerts";
import { detect } from "./detect";
import { buildStreams } from "./streams";
import type { DetectionInput } from "./types";
import { keyOf } from "./unusual";
import { addDays } from "./units";

const LATER_SCAN: AlertContext = { knownFindings: new Set(), firstScan: false };
const keys = (alerts: { key: string }[]) => alerts.map((a) => a.key);

// Twelve ordinary card purchases at different shops over the last few months.
const everyday = Array.from({ length: 12 }, (_, i) =>
  tx({
    accountId: CARD.id,
    date: addDays(AS_OF, -10 - i * 7),
    amountCents: 6_000 + i * 100,
    description: `CORNER SHOP ${String.fromCharCode(65 + i)}`,
    merchantName: `Corner Shop ${String.fromCharCode(65 + i)}`,
    pfcPrimary: "GENERAL_MERCHANDISE",
  }),
);

describe("large_charge", () => {
  const run = (data: DetectionInput) => largeChargeAlerts(data, buildStreams(data));
  const big = (overrides = {}) =>
    tx({
      accountId: CARD.id,
      date: addDays(AS_OF, -2),
      amountCents: 120_000,
      description: "BEST ELECTRONICS 0099",
      merchantName: "Best Electronics",
      pfcPrimary: "GENERAL_MERCHANDISE",
      ...overrides,
    });

  it("flags a recent charge far above the account's usual", () => {
    const charge = big();
    const [alert] = run(input({ transactions: [...everyday, charge] }));
    expect(alert).toMatchObject({
      type: "large_charge",
      key: charge.id,
      title: "$1,200.00 at Best Electronics",
    });
    expect(alert.body).toContain("Example Rewards Card");
  });

  it("says nothing for a normal charge, an old one, a transfer, or too little history", () => {
    expect(run(input({ transactions: [...everyday, big({ amountCents: 9_000 })] }))).toEqual([]);
    expect(run(input({ transactions: [...everyday, big({ date: addDays(AS_OF, -30) })] }))).toEqual(
      [],
    );
    expect(
      run(input({ transactions: [...everyday, big({ pfcPrimary: "TRANSFER_OUT" })] })),
    ).toEqual([]);
    expect(run(input({ transactions: [...everyday.slice(0, 4), big()] }))).toEqual([]);
  });

  it("leaves out a business owner's payroll and suppliers, as unusual activity does (books QA)", () => {
    const payroll = big({
      amountCents: 430_000,
      description: "GUSTO PAYROLL",
      merchantName: "Gusto",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
    });
    const data = input({ transactions: [...everyday, payroll] });
    const streams = buildStreams(data);
    expect(largeChargeAlerts(data, streams)).toHaveLength(1);
    expect(largeChargeAlerts(data, streams, new Set(UNUSUAL_EXPECTED_FOR_BUSINESS))).toEqual([]);
  });

  it("ignores a large recurring bill like rent", () => {
    const rent = monthly(6, 200_000, {
      description: "OAK STREET APARTMENTS",
      merchantName: "Oak Street Apartments",
      pfcPrimary: "RENT_AND_UTILITIES",
      accountId: CARD.id,
    }).map((t, i, all) => (i === all.length - 1 ? { ...t, date: addDays(AS_OF, -1) } : t));
    expect(run(input({ transactions: [...everyday, ...rent] }))).toEqual([]);
  });
});

describe("duplicate_charge", () => {
  const charge = (date: string, overrides = {}) =>
    tx({
      accountId: CARD.id,
      date,
      amountCents: 4_999,
      description: "GADGET SHOP 12",
      merchantName: "Gadget Shop",
      pfcPrimary: "GENERAL_MERCHANDISE",
      ...overrides,
    });

  it("flags the second of two same-amount charges a day apart", () => {
    const first = charge(addDays(AS_OF, -2));
    const second = charge(addDays(AS_OF, -1));
    const alerts = duplicateChargeAlerts(input({ transactions: [first, second] }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "duplicate_charge", key: second.id });
    expect(alerts[0].title).toBe("Charged twice? $49.99 at Gadget Shop");
  });

  it("says nothing for different amounts, days apart, small amounts or coffee", () => {
    const none = (transactions: ReturnType<typeof charge>[]) =>
      expect(duplicateChargeAlerts(input({ transactions }))).toEqual([]);
    none([charge(addDays(AS_OF, -2)), charge(addDays(AS_OF, -1), { amountCents: 5_000 })]);
    none([charge(addDays(AS_OF, -5)), charge(addDays(AS_OF, -1))]);
    none([charge(addDays(AS_OF, -1), { amountCents: 450 }), charge(AS_OF, { amountCents: 450 })]);
    none([
      charge(addDays(AS_OF, -1), { pfcPrimary: "FOOD_AND_DRINK", amountCents: 1_250 }),
      charge(AS_OF, { pfcPrimary: "FOOD_AND_DRINK", amountCents: 1_250 }),
    ]);
    // Two weeks ago is too old to alert on now.
    none([charge(addDays(AS_OF, -15)), charge(addDays(AS_OF, -14))]);
  });

  it("treats the same charge on two different accounts as two purchases", () => {
    expect(
      duplicateChargeAlerts(
        input({ transactions: [charge(AS_OF), charge(AS_OF, { accountId: CHECKING.id })] }),
      ),
    ).toEqual([]);
  });
});

describe("fee_charged", () => {
  const fee = (overrides = {}) =>
    tx({
      date: addDays(AS_OF, -3),
      amountCents: 3_500,
      description: "OVERDRAFT FEE",
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      ...overrides,
    });

  it("flags each recent bank or card fee", () => {
    const overdraft = fee();
    const interest = fee({ pfcDetailed: "BANK_FEES_INTEREST_CHARGE", accountId: CARD.id });
    const alerts = feeAlerts(input({ transactions: [overdraft, interest] }));
    expect(keys(alerts).sort()).toEqual([overdraft.id, interest.id].sort());
    expect(alerts.find((a) => a.key === overdraft.id)?.title).toBe(
      "$35.00 fee on Everyday Checking",
    );
  });

  it("says nothing for an old fee, a refunded fee, or a purchase", () => {
    expect(
      feeAlerts(
        input({
          transactions: [
            fee({ date: monthsAgo(2) }),
            fee({ amountCents: -3_500 }),
            tx({ ...GROCERIES, date: AS_OF }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("price_increase", () => {
  it("alerts when the new price was charged recently, keyed by that charge", () => {
    const data = sampleYear(); // Netflix went from $15.49 to $17.99 this month.
    const alerts = priceIncreaseAlerts(data, detect(data));
    expect(alerts).toEqual([
      expect.objectContaining({
        type: "price_increase",
        key: `merchant:netflix:${AS_OF}`,
        title: "Netflix went up from $15.49 to $17.99",
      }),
    ]);
  });

  it("says nothing when the increase was charged weeks ago", () => {
    const data = { ...sampleYear(), asOf: addDays(AS_OF, 20) };
    expect(priceIncreaseAlerts(data, detect(data))).toEqual([]);
  });
});

describe("new_subscription", () => {
  const data = input({ transactions: monthly(4, 1549, { ...NETFLIX, accountId: CARD.id }) });
  const candidates = detect(data);

  it("alerts on a subscription this scan found for the first time", () => {
    expect(newSubscriptionAlerts(data, candidates, LATER_SCAN)).toEqual([
      expect.objectContaining({
        type: "new_subscription",
        key: "merchant:netflix",
        title: "New subscription: Netflix, $15.49",
      }),
    ]);
  });

  it("says nothing on the first scan, for a known subscription, or a lapsed one", () => {
    expect(newSubscriptionAlerts(data, candidates, { ...LATER_SCAN, firstScan: true })).toEqual([]);
    const known = new Set(["subscription_review\u0000merchant:netflix"]);
    expect(
      newSubscriptionAlerts(data, candidates, { ...LATER_SCAN, knownFindings: known }),
    ).toEqual([]);
    const later = { ...data, asOf: addDays(AS_OF, 20) };
    expect(newSubscriptionAlerts(later, detect(later), LATER_SCAN)).toEqual([]);
  });
});

describe("low_balance", () => {
  const geico = [3, 2, 1, 0].map((m) =>
    tx({ ...GEICO, date: monthsAgo(m, 1), amountCents: 9_800 }),
  );
  const withBalance = (cents: number) =>
    input({ accounts: [{ ...CHECKING, currentBalanceCents: cents }], transactions: geico });

  it("alerts once per account per month of the dip", () => {
    const data = withBalance(15_000);
    expect(lowBalanceAlerts(data, detect(data))).toEqual([
      expect.objectContaining({ type: "low_balance", key: "account:acct_checking:2026-11" }),
    ]);
    // The day is in the title, once, as people read it.
    const [alert] = lowBalanceAlerts(data, detect(data));
    expect(alert.title).toMatch(/around Nov 1$/);
    expect(alert.body).not.toMatch(/\d{4}-\d{2}-\d{2}|around/);
  });

  it("says nothing with enough cushion", () => {
    expect(lowBalanceAlerts(withBalance(50_000), detect(withBalance(50_000)))).toEqual([]);
  });
});

describe("detectAlerts", () => {
  it("is stable: a rescan of the same data gives the same alerts", () => {
    const data = input({
      transactions: [
        ...sampleYear().transactions,
        tx({ date: AS_OF, amountCents: 3_500, pfcDetailed: "BANK_FEES_OVERDRAFT_FEES" }),
      ],
    });
    const first = detectAlerts(data, detect(data), LATER_SCAN);
    expect(first.length).toBeGreaterThan(0);
    expect(detectAlerts(data, detect(data), LATER_SCAN)).toEqual(first);
    expect(new Set(first.map((a) => `${a.type}:${a.key}`)).size).toBe(first.length);
  });

  it("raises nothing for a quiet month", () => {
    const data = input({ transactions: monthly(6, 1199, { ...GEICO, pfcDetailed: null }) });
    const quiet = { ...data, asOf: addDays(AS_OF, 10) };
    expect(detectAlerts(quiet, detect(quiet), LATER_SCAN)).toEqual([]);
  });
});

describe("bill_due", () => {
  // Geico every month on the 17th, from checking; AS_OF is Oct 15, so the next is in 2 days.
  const geico = [4, 3, 2, 1].map((m) =>
    tx({ ...GEICO, date: monthsAgo(m, 17), amountCents: 9_800 }),
  );
  const withBalance = (cents: number, asOf = AS_OF) =>
    input({
      asOf,
      accounts: [{ ...CHECKING, currentBalanceCents: cents }],
      transactions: geico,
    });

  it("reminds before a bill, not urgent when there's enough money", () => {
    expect(billReminderAlerts(withBalance(200_000))).toEqual([
      expect.objectContaining({
        type: "bill_due",
        key: "Geico:2026-10-17",
        title: "Geico, about $98.00, due Oct 17",
        urgent: false,
      }),
    ]);
  });

  it("is urgent when the balance could be under the cushion on the due date", () => {
    const [alert] = billReminderAlerts(withBalance(12_000));
    expect(alert).toMatchObject({ urgent: true });
    expect(alert.body).toContain("$22.00");
  });

  it("says nothing when the next bill is further off, or just went out", () => {
    expect(billReminderAlerts(withBalance(200_000, "2026-10-10"))).toEqual([]);
    expect(billReminderAlerts(withBalance(200_000, "2026-10-17"))).toEqual([]);
  });

  it("uses the same key on a rescan, and a new one for next month's bill", () => {
    const now = billReminderAlerts(withBalance(200_000)).map((a) => a.key);
    expect(billReminderAlerts(withBalance(200_000)).map((a) => a.key)).toEqual(now);
    const november = billReminderAlerts(
      input({
        asOf: "2026-11-15",
        accounts: [{ ...CHECKING, currentBalanceCents: 200_000 }],
        transactions: [...geico, tx({ ...GEICO, date: "2026-10-17", amountCents: 9_800 })],
      }),
    );
    expect(november.map((a) => a.key)).toEqual(["Geico:2026-11-17"]);
  });

  // Books QA: a card payment got the guessed bill reminder and the card's own due-date
  // deadline, with different amounts. The bank's due date is the one reminder.
  const cardPayment = [4, 3, 2, 1].map((m) =>
    tx({
      accountId: CHECKING.id,
      date: monthsAgo(m, 16),
      amountCents: 6_000 + m,
      description: "CHASE CREDIT CRD AUTOPAY THANK YOU",
      merchantName: null,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    }),
  );
  const withCard = input({
    accounts: [{ ...CHECKING, currentBalanceCents: 200_000 }],
    transactions: [...geico, ...cardPayment],
  });

  it("leaves a card payment to the bank's due date, and keeps other bills", () => {
    const titles = (due?: Set<string>) =>
      billReminderAlerts(withCard, due).map((a) => a.title.split(",")[0]);
    expect(titles()).toEqual(["Chase card payment", "Geico"]);
    // The key it had before it was named for its card: a reminder already sent isn't sent again.
    expect(billReminderAlerts(withCard)[0].key).toMatch(/^Credit card payment:\d{4}-\d{2}-\d{2}$/);
    expect(titles(new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]))).toEqual(["Geico"]);
  });

  it("counts a payment as covered only when every such account reports a due date", () => {
    const card = (nextDue: string | null) => ({ type: "credit", subtype: "credit card", nextDue });
    const car = { type: "loan", subtype: "auto", nextDue: "2026-10-20" };
    expect([...dueReportedCategories([card("2026-10-18"), car], AS_OF)].sort()).toEqual([
      "LOAN_PAYMENTS_CAR_PAYMENT",
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    ]);
    // One card without a date, or a date already past, leaves card reminders on.
    expect([...dueReportedCategories([card("2026-10-18"), card(null)], AS_OF)]).toEqual([]);
    expect([...dueReportedCategories([card("2026-10-01")], AS_OF)]).toEqual([]);
    // Accounts that aren't cards or loans don't count.
    expect([
      ...dueReportedCategories([{ type: "depository", subtype: "checking", nextDue: null }], AS_OF),
    ]).toEqual([]);
  });
});

describe("estimated_tax", () => {
  const gig = tx({
    accountId: CHECKING.id,
    date: "2026-11-20",
    amountCents: -80_000,
    description: "UPWORK ESCROW",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_CONTRACTOR",
  });
  const on = (asOf: string, transactions = [gig]) =>
    estimatedTaxAlerts(input({ asOf, transactions }));

  it("reminds 14 days before the next date, for people with contracting or gig income", () => {
    expect(on("2027-01-01")).toEqual([
      expect.objectContaining({
        type: "estimated_tax",
        key: "2027-01-15",
        title: "IRS estimated-payment date: Jan 15",
      }),
    ]);
    expect(on("2027-01-01")[0].body).toContain("this is not tax advice.");
    expect(on("2027-01-01")[0].body).not.toMatch(/\$/);
  });

  it("uses the date as the key, so each date is raised once", () => {
    expect(keys(on("2027-01-01"))).toEqual(keys(on("2027-01-15")));
    expect(keys(on("2027-04-02"))).toEqual(["2027-04-15"]);
  });

  it("says nothing earlier than 14 days out, or without such income", () => {
    expect(on("2026-12-31")).toEqual([]);
    expect(on("2027-01-01", [{ ...gig, pfcDetailed: "INCOME_SALARY" }])).toEqual([]);
    // Money out in the category (a payment back) isn't income.
    expect(on("2027-01-01", [{ ...gig, amountCents: 80_000 }])).toEqual([]);
  });
});

// Spec step 263 (QA sweep): no "banks often take a fee back" for a processor's fees.
describe("fee alerts and a payment processor", () => {
  it("says nothing for Square's processing fees, and still flags a bank fee", () => {
    const square = tx({
      accountId: CHECKING.id,
      date: addDays(AS_OF, -3),
      amountCents: 22_000,
      description: "SQUARE PROCESSING FEES",
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
    });
    const overdraft = tx({
      accountId: CHECKING.id,
      date: addDays(AS_OF, -2),
      amountCents: 3_500,
      description: "OVERDRAFT FEE",
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
    });
    expect(keys(feeAlerts(input({ transactions: [square] })))).toEqual([]);
    expect(keys(feeAlerts(input({ transactions: [square, overdraft] })))).toEqual([overdraft.id]);
  });
});

// docs/feature-audit.md, cluster 10: one charge, one alert.
describe("onePerCharge", () => {
  const alert = (type: AlertCandidate["type"], key: string): AlertCandidate => ({
    type,
    key,
    title: type,
    body: "",
    confidence: { percent: 80, reason: "test" },
  });

  it("asks 'Was this you?' about a big first charge, without the large-charge alert too", () => {
    const jewels = tx({
      accountId: CARD.id,
      date: addDays(AS_OF, -1),
      amountCents: 90_000,
      description: "NEW JEWELLERS",
      merchantName: "New Jewellers",
      pfcPrimary: "GENERAL_MERCHANDISE",
    });
    const data = input({ transactions: [...everyday, jewels] });
    const all = detectAlerts(data, detect(data), LATER_SCAN);
    const about = (alerts: AlertCandidate[]) =>
      alerts.filter((a) => a.key.endsWith(jewels.id)).map((a) => a.type);
    // Both rules see it...
    expect(about(all).sort()).toEqual(["large_charge", "unusual_activity"]);
    // ...and it's said once, with "This was me" and "Not me".
    expect(about(onePerCharge(all))).toEqual(["unusual_activity"]);
  });

  it("keeps 'Charged twice?' (and its refund card) over the unusual double", () => {
    const double = alert("unusual_activity", keyOf("double", "streamco", "tx_2"));
    const twice = alert("duplicate_charge", "tx_2");
    expect(onePerCharge([double, twice])).toEqual([twice]);
    // A different charge isn't touched.
    const other = alert("unusual_activity", keyOf("double", "streamco", "tx_9"));
    expect(onePerCharge([other, twice])).toEqual([other, twice]);
  });

  it("keeps the large-charge alert when it's the only one about the charge", () => {
    // E.g. the person turned unusual-activity alerts off: the large charge still alerts.
    const large = alert("large_charge", "tx_1");
    expect(onePerCharge([large])).toEqual([large]);
    const spikeElsewhere = alert("unusual_activity", keyOf("spike", "shop", "tx_5"));
    expect(onePerCharge([large, spikeElsewhere])).toEqual([large, spikeElsewhere]);
  });
});

// Every alert says how sure Jane is (founder: a confidence % on each).
describe("confidence", () => {
  it("comes with every alert, from the charges behind it", () => {
    const data = sampleYear();
    const alerts = detectAlerts(data, detect(data), {
      knownFindings: new Set(),
      firstScan: false,
    });
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(a.confidence.percent).toBeGreaterThan(0);
      expect(a.confidence.percent).toBeLessThanOrEqual(100);
      expect(a.confidence.reason).toMatch(/in \d+ months? of data$/);
    }
  });

  it("is no surer than the calibration allows for a double charge", () => {
    const pair = [1, 2].map(() =>
      tx({ ...GROCERIES, date: "2026-10-14", amountCents: 8_412, accountId: CARD.id }),
    );
    const history = monthly(12, 1_000, { description: "COFFEE" });
    const [alert] = duplicateChargeAlerts(input({ transactions: [...history, ...pair] }));
    expect(alert.confidence.percent).toBeLessThanOrEqual(DUPLICATE_CHARGE_MAX_PERCENT);
  });

  it("is surer for a fee with more history behind it", () => {
    const fee = (date: string) =>
      tx({
        date,
        amountCents: 3_400,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      });
    const [short] = feeAlerts(input({ transactions: [fee("2026-10-14")] }));
    const [long] = feeAlerts(
      input({ historyFrom: "2025-10-15", transactions: [fee("2026-10-14")] }),
    );
    expect(short.confidence.percent).toBeLessThan(long.confidence.percent);
    expect(long.confidence.reason).toBe("1 fee charge in 12 months of data");
  });

  it("counts every fee in the data for a fee alert, not just the one it's about", () => {
    const fee = (date: string, description: string, pfcDetailed: string) =>
      tx({ date, amountCents: 1_200, description, pfcPrimary: "BANK_FEES", pfcDetailed });
    // Four monthly service fees and three ATM fees over four months; only the latest is recent.
    const monthly = ["2026-07-14", "2026-08-14", "2026-09-14", "2026-10-14"].map((d) =>
      fee(d, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    );
    const atm = ["2026-07-20", "2026-08-03", "2026-09-09"].map((d) =>
      fee(d, "ATM FEE", "BANK_FEES_ATM_FEES"),
    );
    const alerts = feeAlerts(
      input({ historyFrom: "2026-06-15", transactions: [...monthly, ...atm] }),
    );
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.confidence.reason).toBe("7 fee charges in 4 months of data");
  });
});
