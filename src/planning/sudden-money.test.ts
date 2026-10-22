import { describe, expect, it } from "vitest";
import { suddenPlan, taxSetAside } from "./sudden-money";

// Spec step 235: the tax set-aside comes first and is figured by kind; the stages never
// exceed what there is.

const BASE = { marginalRate: 0.24, gainRate: 0.15, filing: "single" as const, basisCents: null };

describe("taxSetAside", () => {
  it("bonus: grosses up the deposit and sets aside the rate above the 22% already withheld", () => {
    // $12,000 net / 0.78 = $15,384.62 gross × 2% extra = $307.69.
    const t = taxSetAside({ kind: "bonus", amountCents: 1_200_000, ...BASE });
    expect(t.cents).toBe(30_769);
    expect(t.note).toMatch(/22% was already taken out; at your 24% rate/);
    expect(
      taxSetAside({ kind: "bonus", amountCents: 1_200_000, ...BASE, marginalRate: 0.12 }).cents,
    ).toBe(0);
  });
  it("inheritance and gift: nothing to set aside", () => {
    expect(taxSetAside({ kind: "inheritance", amountCents: 50_000_000, ...BASE }).cents).toBe(0);
    expect(taxSetAside({ kind: "gift", amountCents: 5_000_000, ...BASE }).cents).toBe(0);
  });
  it("home sale: tax only on gain above the exclusion", () => {
    // $600,000 proceeds, basis $300,000: gain $300,000, exclusion $250,000 (single): $50,000 × 15%.
    expect(
      taxSetAside({ kind: "home_sale", amountCents: 60_000_000, ...BASE, basisCents: 30_000_000 })
        .cents,
    ).toBe(750_000);
    expect(
      taxSetAside({
        kind: "home_sale",
        amountCents: 60_000_000,
        ...BASE,
        basisCents: 30_000_000,
        filing: "married_joint",
      }).cents,
    ).toBe(0);
    // Without a basis: half is assumed gain, and it says so.
    const unknown = taxSetAside({ kind: "home_sale", amountCents: 80_000_000, ...BASE });
    expect(unknown.cents).toBe(Math.round((40_000_000 - 25_000_000) * 0.15));
    expect(unknown.note).toMatch(/Assuming half is gain/);
  });
  it("other sale: capital gains on the gain", () => {
    expect(
      taxSetAside({ kind: "other_sale", amountCents: 10_000_000, ...BASE, basisCents: 6_000_000 })
        .cents,
    ).toBe(600_000);
  });
  it("every kind carries its source", () => {
    for (const kind of ["bonus", "inheritance", "home_sale", "other_sale", "gift"] as const) {
      expect(taxSetAside({ kind, amountCents: 1_000_000, ...BASE }).source.length).toBeGreaterThan(
        10,
      );
    }
  });
});

describe("suddenPlan", () => {
  const input = {
    amountCents: 1_200_000,
    tax: { cents: 30_769, note: "tax", source: "s" },
    cards: [
      { name: "Demo Credit Card", balanceCents: 241_050, aprBps: 2499 },
      { name: "Store card", balanceCents: 50_000, aprBps: 600 },
    ],
    emergencyGapCents: 300_000,
    iraRoomCents: 550_000,
    goalShortfalls: [{ name: "House", cents: 4_000_000 }],
  };
  it("puts tax first, then debt, emergency, limits, goals, and never more than there is", () => {
    const stages = suddenPlan(input);
    expect(stages.map((s) => [s.key, s.cents])).toEqual([
      ["taxes", 30_769],
      ["debt", 241_050],
      ["emergency", 300_000],
      ["limits", 550_000],
      ["goals", 78_181],
    ]);
    expect(stages.reduce((s, x) => s + x.cents, 0)).toBe(1_200_000);
    expect(stages[0].key).toBe("taxes");
    expect(stages[1].note).toBe("Demo Credit Card at 24.99%");
  });
  it("sends what is left to investing, and skips a stage with nothing to do", () => {
    const stages = suddenPlan({
      ...input,
      amountCents: 5_000_000,
      cards: [],
      emergencyGapCents: 0,
      goalShortfalls: [],
    });
    expect(stages.map((s) => s.key)).toEqual(["taxes", "limits", "investing"]);
    expect(stages.at(-1)!.cents).toBe(5_000_000 - 30_769 - 550_000);
  });
  it("holds for any amount: stages add up to at most the deposit, in order", () => {
    for (const amount of [500_000, 777_777, 3_000_000, 90_000_000]) {
      const stages = suddenPlan({ ...input, amountCents: amount });
      expect(stages.reduce((s, x) => s + x.cents, 0)).toBe(amount);
      expect(stages[0].key).toBe("taxes");
    }
  });
});
