import { describe, expect, it } from "vitest";
import {
  GEICO,
  GROCERIES,
  NETFLIX,
  SPOTIFY,
  input,
  monthly,
  monthsAgo,
  tx,
} from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { isAmbiguousRecurring, subscriptionReview } from "./subscription-review";

const run = (data: DetectionInput) => subscriptionReview(data, buildStreams(data));

describe("subscription_review", () => {
  it("finds an active subscription and estimates its annual cost", () => {
    const [finding] = run(input({ transactions: monthly(4, 1549, NETFLIX) }));

    expect(finding).toMatchObject({
      type: "subscription_review",
      key: "merchant:netflix",
      title: "Review your Netflix subscription",
      annualSavingsCents: 18588,
      amountCents: 18588,
      confidence: "medium",
    });
    expect(finding.evidence).toMatchObject({ merchant: "Netflix", frequency: "MONTHLY" });
    expect((finding.evidence.charges as unknown[]).length).toBe(4);
  });

  it("tells two plans of one merchant at two prices apart by their price", () => {
    const transactions = [...monthly(4, 1199, SPOTIFY), ...monthly(4, 1699, SPOTIFY)];
    const titles = run(input({ transactions })).map((f) => f.title);
    expect(titles).toHaveLength(2);
    expect(new Set(titles).size).toBe(2);
    expect(titles).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Review your Spotify.* subscription at \$11\.99$/),
        expect.stringMatching(/^Review your Spotify.* subscription at \$16\.99$/),
      ]),
    );
  });

  // CSV bench, second tuning set: one plan with most of the charges doesn't hide the other.
  it("keeps both plans when one of them has most of the charges", () => {
    const google = { description: "GOOGLE *GOOGLE ONE", pfcPrimary: null, pfcDetailed: null };
    const transactions = [
      ...monthly(6, 999, google),
      ...monthly(5, 299, google).map((t) => ({ ...t, date: t.date.slice(0, 8) + "25" })),
    ];
    expect(run(input({ transactions }))).toHaveLength(2);
  });

  it("recognizes subscription merchants outside subscription categories", () => {
    const transactions = monthly(3, 999, {
      description: "DROPBOX*ABC123XYZ",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    });

    expect(run(input({ transactions })).map((f) => f.key)).toEqual(["merchant:dropbox"]);
  });

  it("finds each subscription billed through an app store, under its own key", () => {
    const apple = {
      description: "APPLE.COM/BILL 866-712-7753 CA",
      pfcPrimary: "GENERAL_MERCHANDISE",
    };
    const transactions = [
      ...monthly(3, 299, apple).map((t) => ({ ...t, date: t.date.slice(0, 8) + "05" })),
      ...monthly(3, 1099, apple),
    ];

    expect(run(input({ transactions })).map((f) => f.key)).toEqual([
      "merchant:apple",
      "merchant:apple@1099",
    ]);
  });

  // CSV bench, second tuning set: a plan at a company that sells something else, by its words.
  it("finds a membership among the same company's other charges, by its words", () => {
    const uber = {
      pfcPrimary: "TRANSPORTATION",
      pfcDetailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    };
    const rides = [3, 2, 1, 0].flatMap((m) => [
      tx({ ...uber, description: "UBER *TRIP", date: monthsAgo(m, 3), amountCents: 1840 }),
      tx({ ...uber, description: "UBER *TRIP", date: monthsAgo(m, 11), amountCents: 2610 }),
      tx({ ...uber, description: "UBER *TRIP", date: monthsAgo(m, 20), amountCents: 999 }),
    ]);
    const plan = monthly(4, 999, { ...uber, description: "UBER *ONE MEMBERSHIP" });
    expect(run(input({ transactions: [...rides, ...plan] })).map((f) => f.key)).toEqual([
      "merchant:uber@plan",
    ]);
    // Rides alone are no plan.
    expect(run(input({ transactions: rides }))).toEqual([]);
  });

  it.each([
    ["DOORDASH DASHPASS", "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"],
    ["WALMART+ 800-925-6278", "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES"],
    ["INSTACART+ MEMBERSHIP", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"],
  ])("calls %s a subscription though its category isn't one", (description, primary, detailed) => {
    const transactions = monthly(4, 999, {
      description,
      pfcPrimary: primary,
      pfcDetailed: detailed,
    });
    expect(run(input({ transactions }))).toHaveLength(1);
  });

  it("keeps one plan written with and without its plan word as one", () => {
    const transactions = monthly(5, 1299, {
      description: "QZAA",
      pfcPrimary: null,
      pfcDetailed: null,
    }).map((t, i) => (i % 2 ? { ...t, description: "QZAA SUBSCRIPTION" } : t));
    expect(run(input({ transactions })).map((f) => f.key)).toEqual(["merchant:qzaa"]);
  });

  it("finds software by its name above the price-only cap", () => {
    const transactions = monthly(3, 24_500, {
      description: "AUTODESK INC",
      pfcPrimary: null,
      pfcDetailed: null,
    });
    expect(run(input({ transactions })).map((f) => f.key)).toEqual(["merchant:autodesk inc"]);
  });

  it("finds a yearly renewal that says so, whoever the company", () => {
    const renewal = tx({
      description: "COSTCO *ANNUAL RENEWAL",
      pfcPrimary: "GENERAL_MERCHANDISE",
      pfcDetailed: "GENERAL_MERCHANDISE_SUPERSTORES",
      date: monthsAgo(4),
      amountCents: 6500,
    });
    const [finding] = run(input({ transactions: [renewal] }));
    expect(finding).toMatchObject({ annualSavingsCents: 6500 });
    // A shopping trip of the same size is not.
    expect(run(input({ transactions: [{ ...renewal, description: "COSTCO WHSE 0412" }] }))).toEqual(
      [],
    );
  });

  it("never calls a payment on a debt a subscription, whatever its name", () => {
    const transactions = monthly(4, 25_000, {
      description: "APPLE CARD PAYMENT",
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    });

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("finds nothing for recurring charges that aren't subscriptions", () => {
    const transactions = [...monthly(4, 5000, GROCERIES), ...monthly(4, 9800, GEICO)];

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("finds nothing for a cancelled subscription", () => {
    const transactions = [6, 5, 4].map((m) =>
      tx({ ...NETFLIX, date: monthsAgo(m), amountCents: 1549 }),
    );

    expect(run(input({ transactions }))).toEqual([]);
  });

  describe("merchants Claude was asked about", () => {
    const CANVA = {
      description: "CANVA* PRO MONTHLY",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    };

    it("treats an ambiguous recurring charge as a subscription once Claude says yes", () => {
      const transactions = monthly(6, 1499, CANVA);

      // One price every month: a plan at low confidence before Claude is asked.
      expect(run(input({ transactions }))).toEqual([
        expect.objectContaining({ key: "merchant:canva", confidence: "low" }),
      ]);
      const [finding] = run(input({ transactions, subscriptionMerchantKeys: ["canva"] }));
      expect(finding).toMatchObject({
        key: "merchant:canva",
        annualSavingsCents: 17988,
        confidence: "medium",
      });
      // Claude said no: one price doesn't make it one.
      expect(run(input({ transactions, declinedSubscriptionMerchantKeys: ["canva"] }))).toEqual([]);
    });

    // QA round 28: a fixed monthly amount isn't a plan when it pays a debt, insures, gives or eats.
    it.each([
      ["HARBOR CREDIT UNION PMT", null, null, 8500],
      ["LEMONADE INSURANCE", null, null, 1800],
      ["PARKSIDE COMMUNITY CHURCH", null, null, 5000],
      ["BLUE HERON BAKERY", null, null, 1430],
      ["HOLLOW OAK TAVERN", null, null, 4610],
      ["NORTHWIND LENDING", "OTHER", "OTHER_OTHER", 7500],
      ["CORNER DELI", "FOOD_AND_DRINK", "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", 1200],
    ])(
      "never calls %s at one price every month a subscription",
      (description, pfcPrimary, pfcDetailed, cents) => {
        const transactions = monthly(5, cents, {
          description,
          merchantName: null,
          pfcPrimary,
          pfcDetailed,
        });
        expect(run(input({ transactions }))).toEqual([]);
      },
    );

    it("needs the very same price every month, and under FIXED_PRICE_SUBSCRIPTION_MAX_CENTS", () => {
      const mystery = { description: "MYSTERY CLUB", pfcPrimary: null, pfcDetailed: null };
      expect(run(input({ transactions: monthly(4, 2000, mystery) }))).toHaveLength(1);
      expect(run(input({ transactions: monthly(4, [2000, 2150, 1980, 2040], mystery) }))).toEqual(
        [],
      );
      // One step up is still a plan's price; a step down, two steps or a big jump are not.
      const plan = (amounts: number[]) =>
        run(input({ transactions: monthly(amounts.length, amounts, mystery) }));
      expect(plan([1499, 1499, 1599, 1599, 1599])).toHaveLength(1);
      expect(plan([1599, 1599, 1499, 1499, 1499])).toEqual([]);
      expect(plan([1000, 1000, 1100, 1100, 1250])).toEqual([]);
      expect(plan([1000, 1000, 2000, 2000])).toEqual([]);
      expect(run(input({ transactions: monthly(4, 145_000, mystery) }))).toEqual([]);
      expect(run(input({ transactions: monthly(2, 2000, mystery) }))).toEqual([]);
    });

    it("caps confidence when only Claude's answer makes it a subscription", () => {
      const transactions = monthly(8, 1499, CANVA);

      const [finding] = run(input({ transactions, subscriptionMerchantKeys: ["canva"] }));

      expect(finding.confidence).toBe("medium");
    });

    it("never overrides a category that rules out a subscription", () => {
      const transactions = monthly(4, 5000, GROCERIES);
      const keys = buildStreams(input({ transactions })).map((s) => s.merchantKey);

      expect(run(input({ transactions, subscriptionMerchantKeys: keys }))).toEqual([]);
    });

    it("asks only about recurring charges whose category doesn't settle it", () => {
      const data = input({
        transactions: [
          ...monthly(4, 1499, CANVA),
          ...monthly(4, 1549, NETFLIX),
          ...monthly(4, 5000, GROCERIES),
          ...monthly(4, 2000, { description: "MYSTERY CLUB", pfcPrimary: null, pfcDetailed: null }),
        ],
      });

      expect(
        buildStreams(data)
          .filter(isAmbiguousRecurring)
          .map((s) => s.merchantKey),
      ).toEqual(["canva", "mystery club"]);
    });
  });
});
