import { describe, expect, it } from "vitest";
import {
  DUPLICATE_CHARGE_MEAL_MIN_CENTS,
  DUPLICATE_CHARGE_MIN_CENTS,
  FIXED_PRICE_SUBSCRIPTION_MAX_CENTS,
  FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES,
  SHORT_HISTORY_DAYS,
} from "@/config/detection";
import { AS_OF, CARD, CHECKING, input, monthly, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import { recurringCharges } from "../subscriptions";
import type { DetectionInput, DetectionTransaction } from "../types";
import { addDays, median, nextOccurrence } from "../units";
import { bankFees } from "./bank-fees";
import { duplicateCharge } from "./duplicate-charge";
import { priceIncrease } from "./price-increase";
import { subscriptionReview } from "./subscription-review";

// From the triage of what Stryker's changes got past (docs/money-rules.md): the exact limit of each
// rule that puts dollars in front of someone, and the rows each must leave out. A limit off by one
// here raises or drops a finding with no other test noticing.

const ago = (days: number) => addDays(AS_OF, -days);
const run = (rule: typeof bankFees, data: DetectionInput) => rule(data, buildStreams(data));

describe("the figures everything is worked from", () => {
  it("takes the middle of an even count as the mean of the two", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("lands a monthly date on the month's last day when it has no such day", () => {
    expect(nextOccurrence("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(nextOccurrence("2026-12-31", "MONTHLY")).toBe("2027-01-31");
    expect(nextOccurrence("2026-02-28", "MONTHLY", 31)).toBe("2026-03-31");
    expect(() => nextOccurrence("2026-01-31", "NEVER")).toThrow(/Unknown frequency/);
  });
});

describe("a double charge's limits", () => {
  const shop = (cents: number, over: Partial<DetectionTransaction> = {}) =>
    tx({
      accountId: CARD.id,
      date: ago(5),
      amountCents: cents,
      description: "GADGET SHOP",
      merchantName: "Gadget Shop",
      pfcPrimary: "GENERAL_MERCHANDISE",
      ...over,
    });
  const found = (rows: DetectionTransaction[]) =>
    run(duplicateCharge, input({ transactions: rows }));

  it("starts at the smallest amount worth asking about", () => {
    const at = DUPLICATE_CHARGE_MIN_CENTS;
    expect(found([shop(at), shop(at)])).toHaveLength(1);
    expect(found([shop(at - 1), shop(at - 1)])).toEqual([]);
  });

  it("counts a meal only from the size two people wouldn't split by chance", () => {
    const meal = { pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_RESTAURANT" };
    const at = DUPLICATE_CHARGE_MEAL_MIN_CENTS;
    expect(found([shop(at, meal), shop(at, meal)])).toHaveLength(1);
    expect(found([shop(at - 1, meal), shop(at - 1, meal)])).toEqual([]);
  });

  it("isn't money coming in: two refunds on a day are two refunds", () => {
    expect(found([shop(-4_999), shop(-4_999)])).toEqual([]);
  });

  it("isn't a day before a group's seats, on either side of the pair", () => {
    const yesterday = { date: ago(6) };
    expect(found([shop(4_999, yesterday), shop(4_999), shop(4_999), shop(4_999)])).toEqual([]);
    const tomorrow = { date: ago(4) };
    expect(found([shop(4_999), shop(4_999), shop(4_999), shop(4_999, tomorrow)])).toEqual([]);
  });
});

describe("a price rise's limits", () => {
  const plan = {
    description: "NETFLIX.COM",
    merchantName: "Netflix",
    pfcPrimary: "ENTERTAINMENT",
    pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
  };
  const rise = (amounts: number[]) =>
    run(priceIncrease, input({ transactions: monthly(amounts.length, amounts, plan) }));

  it("starts at exactly the threshold", () => {
    expect(rise([2000, 2000, 2000, 2100])).toHaveLength(1);
    expect(rise([2000, 2000, 2000, 2099])).toEqual([]);
  });

  it("is worth the rise a year, whatever the plan cost before", () => {
    const [found] = rise([2000, 2000, 2000, 2500]);
    expect(found?.annualSavingsCents).toBe(500 * 12);
  });
});

describe("a fee's limits", () => {
  const fee = (date: string, over: Partial<DetectionTransaction> = {}) =>
    tx({
      date,
      amountCents: 3_000,
      description: "OVERDRAFT FEE",
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      ...over,
    });
  const worth = (historyFrom: string) =>
    run(
      bankFees,
      input({
        historyFrom,
        transactions: [fee(ago(20)), fee(ago(10))],
      }),
    )[0]?.annualSavingsCents;

  it("is at a year's pace under the short-history limit, and as seen from it", () => {
    expect(worth(ago(SHORT_HISTORY_DAYS))).toBe(6_000);
    expect(worth(ago(SHORT_HISTORY_DAYS - 1))).toBeGreaterThan(6_000);
  });

  it("is less sure when Claude sorted any of its rows", () => {
    const rows = (source: "rule" | "plaid" | "llm") =>
      run(
        bankFees,
        input({ transactions: [fee(ago(20)), fee(ago(10), { categorySource: source })] }),
      );
    expect(rows("rule")[0]?.confidence).toBe("high");
    expect(rows("plaid")[0]?.confidence).toBe("high");
    expect(rows("llm")[0]?.confidence).toBe("medium");
  });
});

describe("a charge only its one price makes a question of", () => {
  const unknown = { description: "ACME MONTHLY SVC", merchantName: "Acme Svc" };
  const asks = (transactions: DetectionTransaction[]) =>
    run(subscriptionReview, input({ transactions })).filter(
      (f) => (f.evidence as { onlyItsPrice?: unknown }).onlyItsPrice === true,
    );

  it("needs enough charges", () => {
    const n = FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES;
    expect(asks(monthly(n, 2500, unknown))).toHaveLength(1);
    expect(asks(monthly(n - 1, 2500, unknown))).toEqual([]);
  });

  it("stops at the price nobody leaves on a plan by accident", () => {
    const at = FIXED_PRICE_SUBSCRIPTION_MAX_CENTS;
    expect(asks(monthly(4, at, unknown))).toHaveLength(1);
    expect(asks(monthly(4, at + 1, unknown))).toEqual([]);
  });

  it("is one price, or one step up within the limit, never down", () => {
    expect(asks(monthly(4, [2000, 2000, 2600, 2600], unknown))).toHaveLength(1);
    expect(asks(monthly(4, [2000, 2000, 2601, 2601], unknown))).toEqual([]);
    expect(asks(monthly(4, [2600, 2600, 2000, 2000], unknown))).toEqual([]);
    expect(asks(monthly(5, [2000, 2100, 2000, 2200, 2000], unknown))).toEqual([]);
  });

  it("is only every month", () => {
    const quarterly = [270, 180, 90, 0].map((days) =>
      tx({ ...unknown, date: ago(days), amountCents: 2500 }),
    );
    expect(asks(quarterly)).toEqual([]);
  });

  it("isn't what its category says is something else", () => {
    const debt = { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT" };
    expect(asks(monthly(4, 2500, { ...unknown, ...debt }))).toEqual([]);
  });
});

describe("the list of regular charges leaves out", () => {
  const listed = (data: Partial<DetectionInput>) =>
    recurringCharges(input(data)).map((r) => r.merchantKey);
  const cardPayment = {
    description: "PAYMENT TO EXAMPLE REWARDS CARD",
    merchantName: "Example Rewards",
    pfcPrimary: "LOAN_PAYMENTS",
    pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  };

  it("money moved to the person's own accounts", () => {
    const own = {
      description: "TRANSFER TO SAVINGS",
      merchantName: "Savings Move",
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    };
    expect(listed({ transactions: monthly(4, 20_000, own) })).toEqual([]);
  });

  it("paying a card on the card's own statement", () => {
    const rows = monthly(4, 50_000, { ...cardPayment, accountId: CARD.id });
    const purchase = tx({ accountId: CARD.id, date: ago(3), amountCents: 1_200 });
    expect(listed({ accounts: [CHECKING, CARD], transactions: [...rows, purchase] })).toEqual([]);
  });

  it("but not a bill on a checking account that happens to be named like one", () => {
    const rent = {
      description: "OAK RIDGE APTS",
      merchantName: "Oak Ridge Apts",
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed: "RENT_AND_UTILITIES_RENT",
    };
    expect(listed({ accounts: [CHECKING, CARD], transactions: monthly(4, 90_000, rent) })).toEqual([
      "oak ridge apts",
    ]);
  });
});
