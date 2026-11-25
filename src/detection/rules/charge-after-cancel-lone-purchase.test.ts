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

describe("one unrelated purchase before the cancel is not the plan's price", () => {
  it("still owes the $11.99 renewal when the only earlier charge was a $180 purchase", () => {
    const data = input({
      transactions: [hulu(90, 18_000), hulu(10)],
      cancelledMerchants: cancelled,
    });
    const [finding] = run(data);
    expect(finding?.amountCents).toBe(1_199);
  });

  it("takes the recurring price, not the lone purchase, when both are in the history", () => {
    const data = input({
      transactions: [hulu(120), hulu(90, 18_000), hulu(60), hulu(10), hulu(5, 18_000)],
      cancelledMerchants: cancelled,
    });
    const [finding] = run(data);
    expect(finding?.amountCents).toBe(1_199);
    expect(finding?.evidence.charges).toHaveLength(1);
  });
});
