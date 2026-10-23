import { describe, expect, it } from "vitest";
import { rateStep, type CardInterest, type CardView } from "./card-interest";

// docs/feature-audit.md, cluster 14: the yearly debt review and the monthly check-up read the
// same lower-rate step, so the page never shows "Ask X" next to "Asked Y this month".

const card = (name: string, sent: boolean): CardView => ({
  accountId: `acct-${name}`,
  debtKey: `card:${name}`,
  name,
  balanceCents: 300_000,
  aprBps: 2_499,
  interestYearCents: 70_000,
  payEarly: null,
  statementClosesOn: null,
  rate: {
    id: `rate-${name}`,
    newAprBps: 2_199,
    savingYearlyCents: 9_000,
    body: "Please lower my rate.",
    script: "Hi, I'd like a lower rate.",
    sent: sent
      ? {
          id: `req-${name}`,
          status: "sent",
          sentOn: "2026-10-20",
          resolvedOn: null,
          newAprBps: null,
          savingYearlyCents: 9_000,
          outcome: null,
        }
      : null,
  },
});

const ci = (cards: CardView[], sentOn: string[] = []): CardInterest => ({
  available: true,
  asOf: "2026-10-27",
  cards,
  promos: [],
  interestYearCents: 0,
  grantedSavingCents: 0,
  requests: sentOn.map((on, i) => ({
    id: `req-${i}`,
    status: "sent",
    sentOn: on,
    resolvedOn: null,
    newAprBps: null,
    savingYearlyCents: 9_000,
    outcome: null,
    cardName: cards[i]?.name ?? "Card",
  })),
});

describe("rateStep", () => {
  it("says the request sent this month first, before the next card to ask", () => {
    const step = rateStep(
      ci([card("Visa", true), card("Amex", false)], ["2026-10-20"]),
      "2026-10-27",
    );
    expect(step).toEqual({ kind: "asked", cards: ["Visa"] });
  });

  it("offers the next card once the last request is over a month old", () => {
    const step = rateStep(
      ci([card("Visa", true), card("Amex", false)], ["2026-09-01"]),
      "2026-10-27",
    );
    expect(step).toEqual({
      kind: "next",
      name: "Amex",
      requestId: "rate-Amex",
      savingYearlyCents: 9_000,
    });
  });

  it("has nothing to say when no card is worth asking, or rate requests aren't available", () => {
    expect(rateStep(ci([card("Visa", true)], ["2026-08-01"]), "2026-10-27")).toBeNull();
    expect(rateStep({ ...ci([card("Amex", false)]), available: false }, "2026-10-27")).toBeNull();
  });
});
