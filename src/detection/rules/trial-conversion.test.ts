import { describe, expect, it } from "vitest";
import { AS_OF, CARD, input, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput, DetectionTransaction } from "../types";
import { addDays } from "../units";
import { trialConversion } from "./trial-conversion";

const run = (data: DetectionInput) => trialConversion(data, buildStreams(data));
const STREAMFLIX = {
  accountId: CARD.id,
  description: "STREAMFLIX TRIAL",
  merchantName: "Streamflix",
  pfcPrimary: "ENTERTAINMENT",
  pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
};
const at = (daysAgo: number, amountCents: number, overrides: Partial<DetectionTransaction> = {}) =>
  tx({ ...STREAMFLIX, date: addDays(AS_OF, -daysAgo), amountCents, ...overrides });

describe("trial_conversion", () => {
  it("finds a $1 trial followed by a full charge", () => {
    const [finding] = run(input({ transactions: [at(20, 100), at(6, 1_299)] }));

    expect(finding).toMatchObject({
      type: "trial_conversion",
      key: "merchant:streamflix",
      title: "Your Streamflix trial turned into a $12.99 charge",
      annualSavingsCents: 1_299,
      confidence: "medium",
    });
  });

  it("is low confidence (not counted) for a merchant that isn't subscription-like", () => {
    const shop = { pfcPrimary: "GENERAL_MERCHANDISE", pfcDetailed: null, merchantName: "Shop" };
    const [finding] = run(input({ transactions: [at(20, 0, shop), at(6, 2_500, shop)] }));
    expect(finding.confidence).toBe("low");
  });

  it("ignores look-alikes", () => {
    const none = (transactions: DetectionTransaction[]) =>
      expect(run(input({ transactions }))).toEqual([]);
    // A fuel pump's $1 hold and the fill-up the same day.
    const gas = { pfcPrimary: "TRANSPORTATION", pfcDetailed: "TRANSPORTATION_GAS" };
    none([at(10, 100, gas), at(10, 4_500, gas)]);
    // Same merchant, but the "trial" is the same day as the charge.
    none([at(10, 100), at(9, 1_299)]);
    // The first charge was already full price: an ordinary subscription.
    none([at(40, 1_299), at(10, 1_299)]);
    // The full charge came months after the small one.
    none([at(150, 100), at(90, 1_299)]);
    // A small second charge isn't a conversion.
    none([at(20, 100), at(6, 300)]);
    // Too long ago to ask for a refund.
    none([at(100, 100), at(80, 1_299)]);
  });
});
