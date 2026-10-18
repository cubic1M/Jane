import { describe, expect, it } from "vitest";
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
  detectAlerts,
  duplicateChargeAlerts,
  feeAlerts,
  largeChargeAlerts,
  lowBalanceAlerts,
  newSubscriptionAlerts,
  priceIncreaseAlerts,
  type AlertContext,
} from "./alerts";
import { detect } from "./detect";
import { buildStreams } from "./streams";
import type { DetectionInput } from "./types";
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
      charge(addDays(AS_OF, -1), { pfcPrimary: "FOOD_AND_DRINK" }),
      charge(AS_OF, { pfcPrimary: "FOOD_AND_DRINK" }),
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
    expect(lowBalanceAlerts(detect(data))).toEqual([
      expect.objectContaining({ type: "low_balance", key: "account:acct_checking:2026-11" }),
    ]);
  });

  it("says nothing with enough cushion", () => {
    expect(lowBalanceAlerts(detect(withBalance(50_000)))).toEqual([]);
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
