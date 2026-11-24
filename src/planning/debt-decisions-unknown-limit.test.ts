import { describe, expect, it } from "vitest";
import { closeCard, payoffHurts, type DecisionInput } from "./debt-decisions";

// CodeRabbit sweep 1b: with one card's limit unknown, "close a card" and "paying off" worked the
// card use out on the other cards alone and named the smallest of them as the one to close.
const cards: DecisionInput["cards"] = [
  { name: "Store Card", balanceCents: 149_000, aprBps: 3_199, limitCents: 200_000 },
  { name: "Mystery Card", balanceCents: 400_000, aprBps: 2_500, limitCents: null },
];
const input = { cards, totalLimitCents: null } as unknown as DecisionInput;

describe("a card with no known limit", () => {
  it("closeCard gives no use percentages", () => {
    const text = closeCard(input).sentences.join(" ");
    expect(text).not.toMatch(/\d+%/);
    expect(text).toMatch(/limit on 1 of your 2 cards/);
  });
  it("payoffHurts says the use is of the cards it knows", () => {
    const text = payoffHurts(input).sentences.join(" ");
    expect(text).toMatch(/1 of your 2 cards whose limit I know/);
  });
});
