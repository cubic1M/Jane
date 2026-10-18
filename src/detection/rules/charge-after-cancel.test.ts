import { describe, expect, it } from "vitest";
import { AS_OF, CARD, HULU, NETFLIX, input, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { addDays } from "../units";
import { chargeAfterCancel } from "./charge-after-cancel";

const run = (data: DetectionInput) => chargeAfterCancel(data, buildStreams(data));
const hulu = (daysAgo: number) =>
  tx({ ...HULU, accountId: CARD.id, date: addDays(AS_OF, -daysAgo), amountCents: 1_199 });
const cancelled = (daysAgo: number) => [
  { merchantKey: "hulu", cancelledOn: addDays(AS_OF, -daysAgo) },
];

describe("charge_after_cancel", () => {
  it("totals the charges after we cancelled, high confidence", () => {
    const [finding] = run(
      input({ transactions: [hulu(70), hulu(40), hulu(10)], cancelledMerchants: cancelled(50) }),
    );

    expect(finding).toMatchObject({
      type: "charge_after_cancel",
      key: "merchant:hulu",
      title: "Hulu charged you $23.98 after you cancelled",
      annualSavingsCents: 2_398,
      confidence: "high",
    });
    expect(finding.evidence.charges).toHaveLength(2);
  });

  it("ignores look-alikes", () => {
    const none = (data: Partial<DetectionInput>) => expect(run(input(data))).toEqual([]);
    // Nothing cancelled, or only charges before the cancellation.
    none({ transactions: [hulu(10)] });
    none({ transactions: [hulu(70), hulu(40)], cancelledMerchants: cancelled(20) });
    // A charge already on its way when we cancelled (inside the grace days).
    none({ transactions: [hulu(19)], cancelledMerchants: cancelled(20) });
    // Another merchant charging after the cancellation.
    none({
      transactions: [tx({ ...NETFLIX, date: addDays(AS_OF, -5), amountCents: 1_549 })],
      cancelledMerchants: cancelled(20),
    });
    // A refund from the cancelled merchant isn't a charge.
    none({
      transactions: [tx({ ...HULU, date: addDays(AS_OF, -5), amountCents: -1_199 })],
      cancelledMerchants: cancelled(20),
    });
  });
});
