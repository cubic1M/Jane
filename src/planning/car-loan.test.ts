import { describe, expect, it } from "vitest";
import {
  addonCandidates,
  addonKindOf,
  cancellationLetter,
  rateChange,
  refundFor,
} from "./car-loan";

// Spec step 245: dealer add-ons found in payments, the refund each kind would give, and what
// changed in the car loan's rates.

describe("addonKindOf", () => {
  it("tells GAP, a warranty and a service contract apart", () => {
    expect(addonKindOf("DEALER GAP INSURANCE")).toBe("gap");
    expect(addonKindOf("Guaranteed Asset Protection")).toBe("gap");
    expect(addonKindOf("EXTENDED WARRANTY CO")).toBe("warranty");
    expect(addonKindOf("VEHICLE SERVICE CONTRACT")).toBe("service");
    expect(addonKindOf("PREPAID MAINTENANCE PLAN")).toBe("service");
    expect(addonKindOf("STARBUCKS")).toBeNull();
  });
});

describe("addonCandidates", () => {
  it("keeps payments big enough to be an add-on", () => {
    const tx = (id: string, description: string, amountCents: number) => ({
      id,
      date: "2025-10-01",
      amountCents,
      description,
      merchantName: null,
    });
    expect(
      addonCandidates([
        tx("a", "GAP COVERAGE DEALER", 69_500),
        tx("b", "Warranty monthly", 3_000),
        tx("c", "Coffee", 500),
        tx("d", "EXTENDED WARRANTY", 189_900),
      ]).map((c) => [c.key, c.kind, c.paidCents]),
    ).toEqual([
      ["tx:a", "gap", 69_500],
      ["tx:d", "warranty", 189_900],
    ]);
  });
});

describe("refundFor, per kind", () => {
  const base = { startedOn: "2025-10-18", today: "2026-10-18" };
  it("GAP: the unused months of the term, less a flat $50", () => {
    const r = refundFor({ ...base, kind: "gap", paidCents: 72_000, termMonths: 72 });
    expect(r).toMatchObject({ monthsUsed: 12, monthsLeft: 60, proRataCents: 60_000 });
    expect(r.feeCents).toBe(5_000);
    expect(r.refundCents).toBe(55_000);
  });
  it("a warranty: the unused months, less 10% of that", () => {
    const r = refundFor({ ...base, kind: "warranty", paidCents: 180_000, termMonths: 60 });
    expect(r.proRataCents).toBe(144_000);
    expect(r.feeCents).toBe(14_400);
    expect(r.refundCents).toBe(129_600);
  });
  it("a service contract: the unused months, less a flat $50", () => {
    const r = refundFor({ ...base, kind: "service", paidCents: 36_000, termMonths: 36 });
    expect(r).toMatchObject({ monthsLeft: 24, proRataCents: 24_000, feeCents: 5_000 });
    expect(r.refundCents).toBe(19_000);
  });
  it("counts whole months only, and gives nothing once the term is over", () => {
    expect(
      refundFor({
        kind: "gap",
        paidCents: 72_000,
        termMonths: 72,
        startedOn: "2025-10-19",
        today: "2026-10-18",
      }).monthsUsed,
    ).toBe(11);
    const over = refundFor({
      kind: "service",
      paidCents: 36_000,
      termMonths: 36,
      startedOn: "2020-01-01",
      today: "2026-10-18",
    });
    expect(over).toMatchObject({ monthsLeft: 0, proRataCents: 0, feeCents: 0, refundCents: 0 });
  });
  it("never lets the fee take more than the refund", () => {
    const r = refundFor({
      kind: "gap",
      paidCents: 72_000,
      termMonths: 72,
      startedOn: "2020-11-18",
      today: "2026-10-18",
    });
    expect(r.refundCents).toBeGreaterThanOrEqual(0);
    expect(r.feeCents).toBeLessThanOrEqual(r.proRataCents);
  });
});

describe("cancellationLetter", () => {
  it("names the add-on, the months left and asks for the refund in writing", () => {
    const refund = refundFor({
      kind: "gap",
      paidCents: 72_000,
      termMonths: 72,
      startedOn: "2025-10-18",
      today: "2026-10-18",
    });
    const letter = cancellationLetter({
      name: "Sam",
      kind: "gap",
      addonName: "Big Dealer",
      paidCents: 72_000,
      startedOn: "2025-10-18",
      termMonths: 72,
      refund,
    });
    expect(letter).toContain("cancel my GAP cover");
    expect(letter).toContain("60 of the 72 months are unused, which I make $600.00");
    expect(letter).toContain("Sam");
  });
});

describe("rateChange", () => {
  const base = {
    lastBestAprBps: 700,
    bestAprBps: 700,
    lastBand: "good",
    band: "good",
    bandOrder: ["excellent", "good", "fair"],
    fallBps: 50,
  };
  it("sees rates fall by enough, and a better band", () => {
    expect(rateChange({ ...base, bestAprBps: 650 })).toBe("rates_fell");
    expect(rateChange({ ...base, bestAprBps: 651 })).toBeNull();
    expect(rateChange({ ...base, band: "excellent" })).toBe("score_rose");
    expect(rateChange({ ...base, band: "fair" })).toBeNull();
  });
  it("has nothing to compare on the first check", () => {
    expect(
      rateChange({ ...base, lastBestAprBps: null, lastBand: null, band: "excellent" }),
    ).toBeNull();
  });
});
