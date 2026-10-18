import { describe, expect, it } from "vitest";
import { GEICO, GROCERIES, NETFLIX, input, monthly, monthsAgo, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { subscriptionReview } from "./subscription-review";

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
});
