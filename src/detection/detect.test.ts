import { describe, expect, it } from "vitest";
import {
  CARD,
  HULU,
  NETFLIX,
  SPOTIFY,
  input,
  monthly,
  plaidStream,
  sampleYear,
} from "./__fixtures__/build";
import { detect } from "./detect";

describe("detect", () => {
  it("runs every rule", () => {
    const keys = detect(sampleYear()).map((f) => `${f.type} ${f.key}`);

    expect(keys).toEqual([
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

// Spec step 263 (QA sweep): the same money was counted twice, in "you pay for 2 video streaming
// services" and in "review your Netflix" (Maya $1,981, the Reyes $3,773).
describe("a duplicate group and the single reviews of its members", () => {
  const total = (found: ReturnType<typeof detect>) =>
    found.reduce((n, f) => n + (f.annualSavingsCents ?? 0), 0);
  const subscriptionDollars = (found: ReturnType<typeof detect>) =>
    found.filter((f) => f.type === "subscription_review" || f.type === "duplicate_subscription");

  it("counts Maya's Netflix and Hulu once: the group, not the group and a review of each", () => {
    const found = detect(
      input({ transactions: [...monthly(12, 1549, NETFLIX), ...monthly(12, 1799, HULU)] }),
    );
    expect(subscriptionDollars(found).map((f) => f.type)).toEqual(["duplicate_subscription"]);
    // The cheaper service, a year: $15.49 times 12, $185.88, and no more.
    expect(total(subscriptionDollars(found))).toBe(1549 * 12);
  });

  it("counts the Reyes' three streaming services once, and still reviews what's alone", () => {
    const disney = {
      description: "DISNEY PLUS",
      merchantName: "Disney+",
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
    };
    const found = detect(
      input({
        transactions: [
          ...monthly(12, 1549, NETFLIX),
          ...monthly(12, 1799, HULU),
          ...monthly(12, 1399, disney),
          ...monthly(12, 1199, SPOTIFY),
        ],
      }),
    );
    const subs = subscriptionDollars(found);
    // One group for the three; Spotify is the only music service, so it keeps its own review.
    expect(subs.map((f) => `${f.type} ${f.key}`).sort()).toEqual([
      "duplicate_subscription group:video_streaming",
      "subscription_review merchant:spotify usa",
    ]);
    expect(total(subs)).toBe(1399 * 12 + 1199 * 12);
  });
});
