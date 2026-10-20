import { describe, expect, it } from "vitest";
import { summaryBody } from "./automatic-copy";

// Spec step 164: the monthly summary says exactly what the log says.

describe("summaryBody", () => {
  it("lists what Jane did by herself with the total, and what waits for a tap", () => {
    const body = summaryBody(
      [
        {
          what: "Rebalanced $400.00 to your target mix (it had drifted off target)",
          cents: 40_000,
        },
        {
          what: "Invested $250.00 of new cash in Demo Brokerage in your target mix",
          cents: 25_000,
        },
      ],
      [{ what: "Asked first, over the cap on one move: Harvested a $300.00 loss", cents: 0 }],
    );
    expect(body).toBe(
      "This month I handled 2 things in your investments by myself, $650.00 in all, within your caps: Rebalanced $400.00 to your target mix (it had drifted off target); Invested $250.00 of new cash in Demo Brokerage in your target mix. Over your caps, so waiting for your tap: Harvested a $300.00 loss. Everything is in the log, with the reason. This was all in the simulated brokerage: no real money moved.",
    );
  });
  it("says so when nothing needed doing", () => {
    expect(
      summaryBody([], [{ what: "Asked first, over this month's cap: Rebalanced $5.00", cents: 0 }]),
    ).toMatch(
      /^I didn't need to change anything in your investments by myself this month\. Over your caps, so waiting for your tap: Rebalanced \$5\.00\./,
    );
  });
});
