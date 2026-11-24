import { describe, expect, it } from "vitest";
import { homeTaxes, type HomeInput } from "./home-taxes";

// CodeRabbit sweep 1b: the $500,000 joint exclusion was given with no word that it needs the
// spouse to pass the use test too (not an input), so the figure now says what it assumes.
const sale = {
  boughtOn: "2019-06-01",
  priceCents: 40_000_000,
  soldOn: "2026-08-01",
  saleCents: 100_000_000,
  costsCents: 0,
  improvements: [],
  daysLivedIn: 1_500,
};
const input = (status: HomeInput["status"]): HomeInput => ({
  year: 2026,
  status,
  agiCents: 20_000_000,
  mortgage: null,
  propertyTax: [],
  stateIncomeTaxCents: 0,
  points: null,
  homeOfficeSqFt: null,
  energy: [],
  sale,
});

describe("home sale exclusion for a joint return", () => {
  it("says what the $500,000 assumes about the spouse", () => {
    const s = homeTaxes(input("married_joint")).sale!;
    expect(s.exclusionCents).toBe(50_000_000);
    expect(s.assumption).toMatch(/spouse also lived in the home 2 of the last 5 years/);
    expect(s.assumption).toMatch(
      /as low as \$250,000\.00, and only if you yourself meet those tests/,
    );
  });
  it("has no such assumption for a single filer", () => {
    expect(homeTaxes(input("single")).sale!.assumption).toBeNull();
  });
});
