import { describe, expect, it } from "vitest";
import { CARD, input, plaidStream, sampleYear } from "./__fixtures__/build";
import { detect } from "./detect";

describe("detect", () => {
  it("runs every rule", () => {
    const keys = detect(sampleYear()).map((f) => `${f.type} ${f.key}`);

    expect(keys).toEqual([
      "subscription_review merchant:hulu",
      "subscription_review merchant:netflix",
      "duplicate_subscription group:video_streaming",
      "price_increase merchant:netflix",
      "bank_fees account:acct_checking",
      "idle_cash depository",
      "insurance_reshop merchant:geico",
      "card_interest account:acct_card",
    ]);
  });

  it("gives identical results on every run, whatever order the data arrives in", () => {
    const data = sampleYear();
    const shuffled = { ...data, transactions: [...data.transactions].reverse() };

    expect(detect(shuffled)).toEqual(detect(data));
    expect(detect(data)).toEqual(detect(data));
  });

  it("keeps one finding per type and key", () => {
    const recurringStreams = [
      plaidStream({ plaidStreamId: "a", accountId: CARD.id }),
      plaidStream({ plaidStreamId: "b", accountId: "acct_checking" }),
    ];

    const found = detect(input({ recurringStreams })).filter(
      (f) => f.type === "subscription_review",
    );

    expect(found).toHaveLength(1);
  });

  it("finds nothing for someone with no data", () => {
    expect(detect(input({ accounts: [] }))).toEqual([]);
  });
});
