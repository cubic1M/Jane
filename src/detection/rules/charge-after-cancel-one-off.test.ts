import { describe, expect, it } from "vitest";
import { AS_OF, CARD, HULU, input, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { addDays } from "../units";
import { chargeAfterCancel } from "./charge-after-cancel";

const run = (data: DetectionInput) => chargeAfterCancel(data, buildStreams(data));
const hulu = (daysAgo: number, amountCents = 1_199) =>
  tx({ ...HULU, accountId: CARD.id, date: addDays(AS_OF, -daysAgo), amountCents });
const cancelled = [{ merchantKey: "hulu", cancelledOn: addDays(AS_OF, -50) }];

describe("a charge after cancelling is the subscription, not another purchase", () => {
  it("doesn't call a one-time purchase at the same merchant a refund owed", () => {
    // $11.99 a month before we cancelled, then a $180 purchase of something else.
    const data = input({
      transactions: [hulu(110), hulu(80), hulu(55), hulu(10, 18_000)],
      cancelledMerchants: cancelled,
    });
    expect(run(data)).toEqual([]);
  });

  it("still counts a charge near the plan's price, and leaves the purchase out of its total", () => {
    const data = input({
      transactions: [hulu(110), hulu(80), hulu(55), hulu(20, 1_299), hulu(10, 18_000)],
      cancelledMerchants: cancelled,
    });
    const [finding] = run(data);
    expect(finding?.amountCents).toBe(1_299);
    expect(finding?.evidence.charges).toHaveLength(1);
  });
});
