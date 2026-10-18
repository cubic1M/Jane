import { describe, expect, it } from "vitest";
import {
  CARD,
  GEICO,
  GROCERIES,
  HULU,
  NETFLIX,
  input,
  monthly,
  plaidStream,
  tx,
} from "./__fixtures__/build";
import { detect } from "./detect";

// A made-up year: two streaming services (one just went up), car insurance, groceries,
// a couple of bank fees, card interest, and more cash than the household needs on hand.
function sampleYear() {
  return input({
    transactions: [
      ...monthly(8, [1549, 1549, 1549, 1549, 1549, 1549, 1549, 1799], {
        ...NETFLIX,
        accountId: CARD.id,
      }),
      ...monthly(8, 1199, { ...HULU, accountId: CARD.id }),
      ...monthly(8, 9800, GEICO),
      ...monthly(8, 180_000, { ...GROCERIES, accountId: CARD.id }),
      tx({
        date: "2026-04-03",
        amountCents: 3400,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      }),
      tx({
        date: "2026-09-25",
        accountId: CARD.id,
        amountCents: 2655,
        description: "PURCHASE INTEREST CHARGE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_INTEREST_CHARGE",
      }),
    ],
  });
}

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
