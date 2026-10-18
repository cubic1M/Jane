import { describe, expect, it } from "vitest";
import { AS_OF, CARD, CHECKING, input, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput, DetectionTransaction } from "../types";
import { addDays } from "../units";
import { duplicateCharge } from "./duplicate-charge";

const run = (data: DetectionInput) => duplicateCharge(data, buildStreams(data));
const charge = (daysAgo: number, overrides: Partial<DetectionTransaction> = {}) =>
  tx({
    accountId: CARD.id,
    date: addDays(AS_OF, -daysAgo),
    amountCents: 4_999,
    description: "GADGET SHOP 12",
    merchantName: "Gadget Shop",
    pfcPrimary: "GENERAL_MERCHANDISE",
    ...overrides,
  });

describe("duplicate_charge", () => {
  it("finds the second of two identical charges a day apart, as a refund", () => {
    const second = charge(9);
    const [finding] = run(input({ transactions: [charge(10), second] }));

    expect(finding).toMatchObject({
      type: "duplicate_charge",
      key: `transaction:${second.id}`,
      title: "Charged twice? $49.99 at Gadget Shop",
      annualSavingsCents: 4_999,
      confidence: "medium",
    });
    expect(finding.evidence.charges).toHaveLength(2);
  });

  it("ignores look-alikes", () => {
    const none = (transactions: DetectionTransaction[]) =>
      expect(run(input({ transactions }))).toEqual([]);
    // Different amounts, or days apart.
    none([charge(10), charge(9, { amountCents: 5_000 })]);
    none([charge(10), charge(6)]);
    // Two accounts.
    none([charge(10), charge(10, { accountId: CHECKING.id })]);
    // Lunch twice, or a small repeat.
    none([
      charge(10, { pfcPrimary: "FOOD_AND_DRINK" }),
      charge(10, { pfcPrimary: "FOOD_AND_DRINK" }),
    ]);
    none([charge(10, { amountCents: 500 }), charge(10, { amountCents: 500 })]);
    // Already refunded by the merchant.
    none([charge(10), charge(10), charge(8, { amountCents: -4_999 })]);
    // Too old to dispute.
    none([charge(90), charge(90)]);
  });
});
