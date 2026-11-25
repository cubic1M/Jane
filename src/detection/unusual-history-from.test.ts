import { describe, expect, it } from "vitest";
import { AS_OF, CARD, input, tx } from "./__fixtures__/build";
import { buildStreams } from "./streams";
import { unusualAlerts } from "./unusual";
import { addDays } from "./units";

// CodeRabbit 1c detn-03 #1: how long the history is ignored `historyFrom`, the day the person's
// data starts, which can be before the transactions loaded.
const charge = (daysAgo: number, cents: number, name = "Gadget Shop") =>
  tx({
    accountId: CARD.id,
    date: addDays(AS_OF, -daysAgo),
    amountCents: cents,
    description: name.toUpperCase(),
    merchantName: name,
    pfcPrimary: "GENERAL_MERCHANDISE",
  });

const alerts = (historyFrom?: string) => {
  // Only the last ten days are loaded, with a large first charge from a new merchant today.
  const data = input({
    transactions: [charge(9, 3_000), charge(0, 90_000, "New Jewellers")],
    ...(historyFrom ? { historyFrom } : {}),
  });
  return unusualAlerts(data, buildStreams(data)).map((a) => a.title);
};

describe("a first large charge and how long the history is", () => {
  it("counts the history from before the loaded transactions", () => {
    expect(alerts(addDays(AS_OF, -200))).toEqual(["$900.00 at New Jewellers, a first charge"]);
  });

  it("still waits when the data really starts days ago", () => {
    expect(alerts(addDays(AS_OF, -9))).toEqual([]);
    expect(alerts()).toEqual([]);
  });
});
