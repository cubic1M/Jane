import { describe, expect, it, vi } from "vitest";

// CodeRabbit part 2: "your cards charge up to X%" is the cards' rate, not a loan's.
const liabilities: { kind: string; aprBps: number | null }[] = [];
vi.mock("@/lib/profile", () => ({ loadProfileInput: async () => ({ liabilities, accounts: [] }) }));
vi.mock("@/lib/goals", () => ({ listGoals: async () => [] }));
vi.mock("@/detectors/helpers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cashKnown: () => true,
  liquidCents: () => 500_000,
  cushionSpendCents: () => 300_000,
}));
const cardDebt = { value: 10_000 };
vi.mock("@/profile/build", () => ({
  buildProfile: () => ({
    facts: {
      monthly_income: { value: null },
      income_pattern: { value: null },
      debt_trouble: { value: false },
      card_debt_cents: cardDebt,
    },
  }),
}));

import { loadDecisionFacts } from "./decision";

const run = () => loadDecisionFacts("u1", { client: {} as never, now: new Date("2026-11-25") });

describe("the rate in a decision answer", () => {
  it("is a card's, not a loan's", async () => {
    liabilities.splice(
      0,
      liabilities.length,
      { kind: "credit", aprBps: 2400 },
      { kind: "student", aprBps: 9000 },
    );
    expect((await run()).topRateBps).toBe(2400);
  });

  it("is none when no card owes anything", async () => {
    cardDebt.value = 0;
    liabilities.splice(0, liabilities.length, { kind: "student", aprBps: 9000 });
    expect((await run()).topRateBps).toBeNull();
    cardDebt.value = 10_000;
  });
});
