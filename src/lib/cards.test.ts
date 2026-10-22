import { describe, expect, it } from "vitest";
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

  // Acceptance criterion: no card with a partner action renders without its disclosure.
  it.each(sampleFindings().map((f) => [f.type] as const))(
    "%s: a card with a partner always carries its disclosure, word for word",
    (type) => {
      const partner = {
        key: "example-bank",
        name: "Example Bank",
        disclosure: "We may earn a referral fee from Example Bank if you open an account.",
      };
      const card = buildCard(asStored(type), partner);
      expect(card.referralDisclosure).toBe(partner.disclosure);
      expect(card.referralPartner).toEqual({ key: "example-bank", name: "Example Bank" });
      expect(() => buildCard(asStored(type), { ...partner, disclosure: "  " })).toThrow(
        /no disclosure/,
      );
    },
  );

  it("says a picked loan option is the person's to apply for, never ours (spec step 282)", () => {
    const loan = (applyWith: string | null) =>
      buildCard({
        id: "finding_loan",
        type: "card_interest",
        title: "Lakeside Credit Union at 6.90% for 60 months",
        annualSavingsCents: 0,
        evidence: { loanPick: true, applyWith, transactions: [] },
        explanation: null,
        explanationHash: null,
      }).whatChanges;
    expect(loan("Lakeside Credit Union")).toBe(
      "We check the option you picked and send you Lakeside Credit Union's steps to apply yourself. Nothing is applied for and no money moves until you do it.",
    );
    expect(loan(null)).toBe(
      "We check the option you picked and send you the steps. Nothing is applied for and no money moves until you do it.",
    );
  });

  it("changes the card hash when a partner is turned off, so old answers are refused", () => {
    const partner = { key: "p", name: "P", disclosure: "We may earn a fee." };
    expect(cardHash(buildCard(asStored("idle_cash"), partner))).not.toBe(
      cardHash(buildCard(asStored("idle_cash"))),
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
