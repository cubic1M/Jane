import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DEMO_CARRIERS, demoCarrier } from "@/data-sources/demo/demo-carriers";
import { DEMO_POLICY } from "./profile";
import { basePremium, demoPartner, nearestDeductible, quotedCoverage } from "./demo-partner";
import { compareCover } from "./like-for-like";
import type { QuoteRequest } from "./partner";

// The quote engine (spec step 103): the stand-in partner's fixed pricing rules and the
// like-for-like comparison. Pure.

const NOW = new Date("2026-10-19T12:00:00Z");
const household = { housing: "own", vehicles: 1, dependants: null, pets: null };
const geico = {
  deductibleCents: DEMO_POLICY.deductibleCents,
  coverage: { ...DEMO_POLICY.coverage },
};
const request = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  kind: "auto",
  state: null,
  household,
  ...geico,
  premiumFrequency: "monthly",
  startDate: "2026-11-28",
  ...over,
});

describe("the stand-in partner's pricing", () => {
  it("prices car cover from the cars, the cover, the deductible and the state", () => {
    const base = basePremium("auto", geico.coverage, 100_000, { state: null, household });
    // $1,100 a car, × 1.6 for collision, comprehensive and uninsured driver, × 0.9 for $1,000.
    expect(Math.round(base!)).toBe(158_400);
    expect(basePremium("auto", geico.coverage, 100_000, { state: "MI", household })).toBeCloseTo(
      158_400 * 1.6,
    );
    expect(
      basePremium("auto", geico.coverage, 100_000, {
        state: null,
        household: { ...household, vehicles: 2 },
      }),
    ).toBeCloseTo(316_800);
    expect(
      basePremium("auto", { ...geico.coverage, collision: false, comprehensive: false }, 100_000, {
        state: null,
        household,
      }),
    ).toBeCloseTo(110_000 * 1.05 * 0.9);
  });

  it("prices every kind it quotes, and not health", () => {
    const at = { state: null, household: { ...household, pets: 2 } };
    expect(basePremium("renters", {}, 50_000, at)).toBeCloseTo(9_000 + 6_000);
    expect(basePremium("home", { dwelling: 40_000_000 }, 100_000, at)).toBeCloseTo(
      140_000 * 1.05 * 0.9,
    );
    expect(basePremium("life", { deathBenefit: 100_000_000, termYears: 30 }, 0, at)).toBeCloseTo(
      56_000,
    );
    expect(basePremium("pet", { reimbursement: 90 }, 50_000, at)).toBeCloseTo(96_000);
    expect(basePremium("health", {}, 0, at)).toBeNull();
  });

  it("quotes the nearest deductible a carrier offers, its own exclusions and caps", () => {
    expect(nearestDeductible(100_000, [50_000, 100_000])).toBe(100_000);
    expect(nearestDeductible(75_000, [50_000, 100_000])).toBe(50_000);
    expect(nearestDeductible(null, [25_000, 100_000])).toBe(25_000);
    const cedar = demoCarrier("demo-cedar")!;
    expect(quotedCoverage("auto", geico.coverage, cedar).uninsuredMotorist).toBe(false);
    const northstar = demoCarrier("demo-northstar")!;
    expect(quotedCoverage("auto", geico.coverage, northstar).propertyDamage).toBe(2_500_000);
    // Anything not asked for is the carrier's default.
    expect(quotedCoverage("renters", {}, demoCarrier("demo-bluepeak")!)).toEqual({
      personalProperty: 3_000_000,
      liability: 10_000_000,
    });
  });

  it("returns demo quotes from every carrier that writes the kind, cheapest first, the same each time", async () => {
    const quotes = await demoPartner.quote(request(), { now: NOW });
    expect(quotes.map((q) => q.carrier.id)).toEqual([
      "demo-northstar",
      "demo-cedar",
      "demo-lighthouse",
      "demo-bluepeak",
    ]);
    expect(quotes.every((q) => q.demo && q.carrier.name.endsWith("(demo)"))).toBe(true);
    const lighthouse = quotes.find((q) => q.carrier.id === "demo-lighthouse")!;
    expect(lighthouse).toMatchObject({
      premiumCents: 10_800,
      annualPremiumCents: 129_600,
      premiumFrequency: "monthly",
      deductibleCents: 100_000,
      expiresAt: "2026-11-18T12:00:00.000Z",
    });
    expect(await demoPartner.quote(request(), { now: NOW })).toEqual(quotes);
    expect(await demoPartner.quote(request({ kind: "health" }), { now: NOW })).toEqual([]);
    expect(DEMO_CARRIERS.every((c) => c.name.endsWith("(demo)"))).toBe(true);
  });

  it("binds, takes the first payment on the start day and cancels, all as a demo", async () => {
    const [quote] = await demoPartner.quote(request(), { now: NOW });
    const binding = await demoPartner.bind(quote, {
      startDate: "2026-11-28",
      holderName: "Alex",
      now: NOW,
    });
    expect(binding.policyNumber).toMatch(/^DEMO-NORTHSTAR-[0-9A-F]{8}$/);
    expect(binding.firstPaymentCents).toBe(quote.premiumCents);
    expect(binding.documents[0].text).toMatch(/^DEMO POLICY/);
    const status = (now: string) =>
      demoPartner.paymentStatus(binding.policyNumber, {
        startDate: "2026-11-28",
        now: new Date(now),
      });
    expect(await status("2026-11-27T23:00:00Z")).toBe("pending");
    expect(await status("2026-11-28T09:00:00Z")).toBe("paid");
    expect(
      await demoPartner.cancel(
        { carrier: "GEICO", policyNumber: null },
        { effectiveDate: "2026-11-28", now: NOW },
      ),
    ).toMatchObject({ status: "cancelled", effectiveDate: "2026-11-28" });
  });
});

describe("like for like", () => {
  it("says the same cover and deductible when they match, or the quote gives more", () => {
    expect(compareCover("auto", geico, geico)).toEqual({
      same: true,
      differences: [],
      better: [],
      unknown: [],
    });
    const more = compareCover("auto", geico, {
      deductibleCents: 50_000,
      coverage: { ...geico.coverage, propertyDamage: 10_000_000 },
    });
    expect(more.same).toBe(true);
    expect(more.better).toEqual([
      "Deductible $500.00 instead of your $1,000.00",
      "Property damage liability: $100,000.00 instead of your $50,000.00",
    ]);
  });

  it("spells out every way the quote gives less", () => {
    const less = compareCover("auto", geico, {
      deductibleCents: 250_000,
      coverage: { ...geico.coverage, propertyDamage: 2_500_000, uninsuredMotorist: false },
    });
    expect(less).toMatchObject({
      same: false,
      differences: [
        "Deductible $2,500.00 instead of your $1,000.00",
        "Property damage liability: $25,000.00 instead of your $50,000.00",
        "Uninsured driver cover: not included, and you have it now",
      ],
    });
  });

  it("names the limits it can't check when the policy doesn't have them", () => {
    expect(
      compareCover(
        "renters",
        { deductibleCents: null, coverage: {} },
        {
          deductibleCents: 50_000,
          coverage: { personalProperty: 3_000_000 },
        },
      ),
    ).toEqual({
      same: true,
      differences: [],
      better: [],
      unknown: ["Deductible", "Your belongings"],
    });
  });
});
