import { describe, expect, it } from "vitest";
import { noneFromShortHistory } from "./invariants";

// The short-history rule (class 6, debug3-invariants.md) on what the walkers found.

describe("a none claim over too little history", () => {
  it("is caught when it doesn't say the history is short", () => {
    const flat = {
      "chat.what bills are coming up.body": "Nothing is coming up that I can see.",
      "chat.what subscriptions do I pay for.body": "I don't see any subscriptions yet.",
      "home.cashFlow.empty": "Nothing due in the next month.",
    };
    expect(noneFromShortHistory(flat, true)).toHaveLength(3);
  });

  it("is let be when it says why, or when the history is long enough", () => {
    expect(
      noneFromShortHistory(
        {
          "home.cashFlow.empty":
            "Too little history to see your bills yet: they show once about two months of transactions are in.",
          "chat.what subscriptions do I pay for.body":
            "I don't see any subscriptions yet: there's too little history to tell.",
        },
        true,
      ),
    ).toEqual([]);
    expect(
      noneFromShortHistory({ "home.cashFlow.empty": "Nothing due in the next month." }, false),
    ).toEqual([]);
  });
});
