import { describe, expect, it } from "vitest";
import {
  AS_OF,
  CARD,
  CHECKING,
  NETFLIX,
  input,
  monthly,
  monthsAgo,
  tx,
} from "@/detection/__fixtures__/build";
import type { DetectionAccount, DetectionTransaction } from "@/detection/types";
import { addDays, daysBetween } from "@/detection/units";
import { irregularCosts, monthlySetAside } from "./irregular";

// AS_OF is 2026-10-15. Spec step 70.

const LOAN: DetectionAccount = {
  id: "acct_loan",
  name: "Car Loan",
  type: "loan",
  subtype: "auto",
  currentBalanceCents: 1_800_000,
};
const BROKERAGE: DetectionAccount = {
  id: "acct_brokerage",
  name: "Brokerage",
  type: "investment",
  subtype: "brokerage",
  currentBalanceCents: 1_200_000,
};

const DUOLINGO = {
  accountId: CARD.id,
  description: "DUOLINGO PLUS",
  merchantName: "Duolingo",
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_EDUCATION",
  amountCents: 2_999,
};
const quarterly = (over: Partial<DetectionTransaction> = {}) =>
  [-361, -270, -179, -88].map((d) => tx({ ...DUOLINGO, ...over, date: addDays(AS_OF, d) }));

const DMV = {
  description: "CA DMV VEHICLE REGISTRATION",
  merchantName: "California DMV",
  pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
  pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
  amountCents: 21_200,
};

const STATE_FARM = {
  description: "STATE FARM INSURANCE",
  merchantName: "State Farm",
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
  amountCents: 64_000,
};

const AMAZON = {
  accountId: CARD.id,
  description: "AMZN MKTP US",
  merchantName: "Amazon",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
};
const GIFTS = {
  accountId: CARD.id,
  description: "ETSY.COM GIFTS",
  merchantName: "Etsy",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES",
};
// Amazon every month for a year, then gifts last November and December.
const shopping = [
  ...monthly(13, 10_000, AMAZON),
  tx({ ...GIFTS, date: "2025-11-24", amountCents: 30_000 }),
  tx({ ...GIFTS, date: "2025-12-10", amountCents: 30_000 }),
];

const accounts = [CHECKING, CARD, LOAN, BROKERAGE];

describe("irregular costs", () => {
  it("turns a quarterly charge into a monthly set-aside", () => {
    const costs = irregularCosts(input({ accounts, transactions: quarterly() }));
    expect(costs.items).toHaveLength(1);
    const [item] = costs.items;
    expect(item).toMatchObject({
      key: "merchant:duolingo",
      name: "Duolingo",
      kind: "bill",
      frequency: "QUARTERLY",
      yearlyCents: 4 * 2_999,
      nextAmountCents: 2_999,
      // $119.96 / 12 = $10.00 (rounded up to the dollar).
      monthlyCents: 1_000,
    });
    expect(item.nextDate > AS_OF).toBe(true);
    expect(costs.monthlyCents).toBe(1_000);
    expect(costs.yearlyCents).toBe(11_996);
  });

  it("finds a yearly bill seen once, like car registration, and what's set aside by now", () => {
    const paid = monthsAgo(5, 10);
    const costs = irregularCosts(input({ accounts, transactions: [tx({ ...DMV, date: paid })] }));
    expect(costs.items).toHaveLength(1);
    const [item] = costs.items;
    expect(item).toMatchObject({
      key: "merchant:california dmv",
      frequency: "ANNUALLY",
      yearlyCents: 21_200,
      nextDate: "2027-05-10",
      // $212 / 12 = $17.67, rounded up to $18.
      monthlyCents: 1_800,
    });
    const share = 1 - daysBetween(AS_OF, "2027-05-10") / 365.25;
    expect(item.byNowCents).toBe(Math.round(21_200 * share));
    expect(item.byNowCents).toBeGreaterThan(0);
    expect(item.byNowCents).toBeLessThan(21_200);
  });

  it("finds a yearly bill seen twice a year apart", () => {
    const fee = {
      description: "COSTCO ANNUAL MEMBERSHIP",
      merchantName: "Costco",
      pfcPrimary: "GENERAL_MERCHANDISE",
      pfcDetailed: "GENERAL_MERCHANDISE_SUPERSTORES",
      amountCents: 6_500,
    };
    const costs = irregularCosts(
      input({
        accounts,
        transactions: [
          tx({ ...fee, date: addDays(AS_OF, -400) }),
          tx({ ...fee, date: addDays(AS_OF, -35) }),
        ],
      }),
    );
    expect(costs.items.map((i) => [i.key, i.frequency, i.yearlyCents])).toEqual([
      ["merchant:costco", "ANNUALLY", 6_500],
    ]);
  });

  it("finds insurance paid twice a year", () => {
    const costs = irregularCosts(
      input({
        accounts,
        transactions: [
          tx({ ...STATE_FARM, date: monthsAgo(8, 3) }),
          tx({ ...STATE_FARM, date: monthsAgo(2, 3) }),
        ],
      }),
    );
    expect(costs.items).toHaveLength(1);
    expect(costs.items[0]).toMatchObject({
      name: "State Farm",
      frequency: "SEMIANNUALLY",
      yearlyCents: 128_000,
      nextDate: monthsAgo(-4, 3),
      monthlyCents: monthlySetAside(128_000),
    });
  });

  it("finds holiday gifts above the usual month of shopping", () => {
    const costs = irregularCosts(input({ accounts, transactions: shopping }));
    expect(costs.items).toEqual([
      expect.objectContaining({
        key: "season:holiday_gifts",
        name: "Holiday gifts",
        kind: "seasonal",
        // November and December, $300 each above the usual $100 month.
        yearlyCents: 60_000,
        nextDate: "2026-11-01",
        monthlyCents: 5_000,
      }),
    ]);
  });

  it("sees no season when shopping is the same all year", () => {
    expect(
      irregularCosts(input({ accounts, transactions: monthly(13, 10_000, AMAZON) })).items,
    ).toEqual([]);
  });

  it("sees no season with too few months to compare against", () => {
    // Three usual months (January to March) aren't enough to say what's usual.
    const recent = shopping.filter((t) => t.date >= "2025-11-01" && t.date <= "2026-04-15");
    expect(
      irregularCosts(input({ asOf: "2026-04-15", accounts, transactions: recent })).items,
    ).toEqual([]);
  });

  it("leaves monthly bills out", () => {
    const costs = irregularCosts(
      input({ accounts, transactions: monthly(12, 1_549, { ...NETFLIX, accountId: CARD.id }) }),
    );
    expect(costs).toEqual({ items: [], monthlyCents: 0, yearlyCents: 0 });
  });

  it("never uses loan or investment accounts", () => {
    const costs = irregularCosts(
      input({
        accounts,
        transactions: [
          ...quarterly({ accountId: LOAN.id }),
          tx({ ...DMV, accountId: BROKERAGE.id, date: monthsAgo(5, 10) }),
          ...shopping.map((t) => ({ ...t, accountId: LOAN.id })),
        ],
      }),
    );
    expect(costs.items).toEqual([]);
  });

  it("leaves transfers and loan payments out, even quarterly", () => {
    const costs = irregularCosts(
      input({
        accounts,
        transactions: quarterly({
          accountId: CHECKING.id,
          description: "TRANSFER TO BROKERAGE",
          merchantName: null,
          pfcPrimary: "TRANSFER_OUT",
          pfcDetailed: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        }),
      }),
    );
    expect(costs.items).toEqual([]);
  });

  it("ignores a one-off charge that isn't the yearly kind", () => {
    const costs = irregularCosts(
      input({
        accounts,
        transactions: [
          tx({
            description: "BEST BUY 00123",
            merchantName: "Best Buy",
            pfcPrimary: "GENERAL_MERCHANDISE",
            pfcDetailed: "GENERAL_MERCHANDISE_ELECTRONICS",
            amountCents: 89_900,
            date: monthsAgo(4),
          }),
        ],
      }),
    );
    expect(costs.items).toEqual([]);
  });

  it("adds everything up, soonest first", () => {
    const costs = irregularCosts(
      input({
        accounts,
        transactions: [...quarterly(), tx({ ...DMV, date: monthsAgo(5, 10) }), ...shopping],
      }),
    );
    expect(costs.items.map((i) => i.key)).toEqual([
      "merchant:duolingo",
      "season:holiday_gifts",
      "merchant:california dmv",
    ]);
    expect(costs.monthlyCents).toBe(5_000 + 1_000 + 1_800);
  });

  it("rounds the monthly set-aside up to the dollar", () => {
    expect(monthlySetAside(12_000)).toBe(1_000);
    expect(monthlySetAside(12_001)).toBe(1_100);
    expect(monthlySetAside(0)).toBe(0);
  });
});
