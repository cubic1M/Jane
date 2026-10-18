import { describe, expect, it } from "vitest";
import { GEICO, GROCERIES, NETFLIX, input, monthly, monthsAgo, tx } from "../__fixtures__/build";
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

  it("recognizes subscription merchants outside subscription categories", () => {
    const transactions = monthly(3, 999, {
      description: "DROPBOX*ABC123XYZ",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    });

    expect(run(input({ transactions })).map((f) => f.key)).toEqual(["merchant:dropbox"]);
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

      expect(run(input({ transactions }))).toEqual([]);
      const [finding] = run(input({ transactions, subscriptionMerchantKeys: ["canva"] }));
      expect(finding).toMatchObject({ key: "merchant:canva", annualSavingsCents: 17988 });
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
