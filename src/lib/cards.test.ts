import { describe, expect, it, vi } from "vitest";
import { REFERRAL_PARTNERS } from "@/config/referrals";
import { findingOfType, sampleFindings } from "./__fixtures__/findings";
import { buildCard, cardHash, type CardFinding } from "./cards";

const asStored = (type: Parameters<typeof findingOfType>[0]): CardFinding => {
  const f = findingOfType(type);
  return {
    id: `finding_${type}`,
    type: f.type,
    title: f.title,
    annualSavingsCents: f.annualSavingsCents,
    evidence: f.evidence,
    explanation: null,
    explanationHash: null,
  };
};

describe("buildCard", () => {
  it.each(sampleFindings().map((f) => [f.type] as const))("fills every section for %s", (type) => {
    const card = buildCard(asStored(type));

    expect(card.title.length).toBeGreaterThan(0);
    expect(card.explanation.length).toBeGreaterThan(0);
    expect(card.whatChanges.length).toBeGreaterThan(0);
    expect(card.giveUp.length).toBeGreaterThan(0);
    expect(card.evidence.length).toBeGreaterThan(0);
    expect(card.referralDisclosure).toBeNull();
  });

  it("says what changes, with the evidence newest first", () => {
    const card = buildCard(asStored("price_increase"));

    expect(card).toMatchObject({
      findingId: "finding_price_increase",
      actionType: "fight_price_increase",
      whatChanges: "We contact Netflix and ask for your old price or a cheaper plan.",
      annualSavingsCents: 3000,
    });
    expect(card.evidence[0]).toMatchObject({ date: "2026-10-15", amountCents: 1799 });
  });

  it("shows a referral disclosure when the action uses a partner", () => {
    vi.spyOn(REFERRAL_PARTNERS, "move_idle_cash", "get").mockReturnValue({
      name: "Example Bank",
      disclosure: "We may earn a referral fee from Example Bank if you open an account.",
    });

    expect(buildCard(asStored("idle_cash")).referralDisclosure).toBe(
      "We may earn a referral fee from Example Bank if you open an account.",
    );
  });
});

describe("cardHash", () => {
  it("is stable for the same card and changes with any of its text", () => {
    const card = buildCard(asStored("bank_fees"));

    expect(cardHash(buildCard(asStored("bank_fees")))).toBe(cardHash(card));
    expect(cardHash({ ...card, giveUp: `${card.giveUp}!` })).not.toBe(cardHash(card));
  });
});
