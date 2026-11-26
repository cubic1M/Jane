import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { CreditBuilding } from "@/lib/credit-building";
import type { CreditCards } from "@/lib/credit-cards";
import { buildCreditReply } from "./credit-building-replies";
import { betterCardReply, cardFeeReply } from "./credit-card-replies";

// CodeRabbit part 2: replies say only what the loaders establish.

describe("the card fee reply", () => {
  it("does not fail when no fee-free card fits their credit band", () => {
    const cards = {
      available: true,
      better: [],
      cards: [
        {
          name: "Sapphire",
          fee: {
            paysForItself: false,
            noFee: null,
            earnsCents: 10_000,
            netCents: -5_000,
            feeCents: 15_000,
          },
        },
      ],
    } as unknown as CreditCards;
    const reply = cardFeeReply(cards);
    expect(reply.body).toContain("It doesn't pay for itself.");
    expect(reply.body).not.toContain("with no fee");
  });
});

describe("the better card reply", () => {
  it("says a short history is a rough guide, not a year of spending", () => {
    const better = {
      card: { id: "c1", name: "Everyday", issuer: "Bank", annualFeeCents: 0, intro: null },
      usedFor: ["groceries"],
      gainCents: 12_000,
      introReachable: false,
    };
    const base = { available: true, better: [better], wallet: { netCents: 0 } };
    const short = betterCardReply({ ...base, firstLook: true } as unknown as CreditCards);
    expect(short.body).toContain("rough guide");
    expect(short.body).not.toContain("over the last year");
    const long = betterCardReply({ ...base, firstLook: false } as unknown as CreditCards);
    expect(long.body).toContain("over the last year");
  });
});

describe("the building credit reply", () => {
  it("does not claim low card use or on-time payments it has no evidence for", () => {
    const empty = {
      available: true,
      score: null,
      estimates: [],
      statement: null,
      thin: false,
      builders: [],
      streak: { months: 0, clean: true },
    } as unknown as CreditBuilding;
    const reply = buildCreditReply(empty);
    expect(reply.body).not.toMatch(/card use is low|on time/);
  });
});
