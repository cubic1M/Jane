import { describe, expect, it } from "vitest";
import type { DebtReview } from "@/lib/debt-review";
import { reviewMessage } from "./debt-review-replies";

// CodeRabbit part 2: the Pay button of the debt review is bound to the amount the review showed, so
// a yes later pays what the card said, not whatever the statement suggests by then.

describe("the debt review message", () => {
  it("carries the reviewed amount on its Pay button", () => {
    const data: DebtReview = {
      available: true,
      advice: false,
      level: "ask",
      review: null,
      due: null,
      items: [
        {
          key: "statements",
          title: "Statement timing",
          status: "tap",
          text: "Pay $120.00 toward your Visa before its statement closes.",
          tap: {
            kind: "pay",
            accountId: "acct_1",
            closesOn: "2026-12-05",
            card: "Visa",
            amountCents: 12_000,
          },
        },
      ],
    };
    const message = reviewMessage(data, "yearly");
    expect(message.refs.creditStatement).toEqual({
      accountId: "acct_1",
      closesOn: "2026-12-05",
      amountCents: 12_000,
    });
  });
});
