import { describe, expect, it } from "vitest";
import { EMPTY_FACTS, factsFromClaude, factsFromForm, rawFacts, yearlyPremiumCents } from "./facts";

describe("document facts (spec step 68)", () => {
  it("reads the person's facts for a policy", () => {
    const result = factsFromForm("insurance_policy", {
      provider: "  GEICO ",
      policyType: "auto",
      coverageSummary: "Two cars, full coverage",
      premiumCents: "612.00",
      premiumFrequency: "semiannual",
      renewalDate: "2027-03-01",
    });
    expect(result).toEqual({
      ok: true,
      facts: {
        ...EMPTY_FACTS,
        provider: "GEICO",
        policyType: "auto",
        coverageSummary: "Two cars, full coverage",
        premiumCents: 61_200,
        premiumFrequency: "semiannual",
        renewalDate: new Date("2027-03-01T00:00:00Z"),
      },
    });
  });

  it("only keeps the fields that kind of document has", () => {
    const result = factsFromForm("receipt", {
      provider: "Target",
      purchaseDate: "2026-10-01",
      purchaseAmountCents: "89.99",
      renewalDate: "2027-01-01",
      premiumCents: "10",
    });
    expect(result).toMatchObject({
      ok: true,
      facts: {
        provider: "Target",
        purchaseAmountCents: 8_999,
        renewalDate: null,
        premiumCents: null,
      },
    });
  });

  it("says which of the person's facts doesn't make sense", () => {
    expect(factsFromForm("insurance_policy", { renewalDate: "03/01/2027" })).toEqual({
      ok: false,
      error: "Renews on: Enter a date like 2027-03-01.",
    });
    expect(factsFromForm("insurance_policy", { renewalDate: "2027-02-30" }).ok).toBe(false);
    expect(factsFromForm("warranty", { warrantyEndsOn: "1850-01-01" }).ok).toBe(false);
    expect(factsFromForm("insurance_policy", { premiumCents: "lots" })).toEqual({
      ok: false,
      error: "Price: Enter an amount like 1,234.56.",
    });
    expect(factsFromForm("insurance_policy", { policyType: "boat" })).toEqual({
      ok: false,
      error: "Type of policy: Pick one from the list.",
    });
    expect(factsFromForm("insurance_policy", { premiumCents: "100" })).toEqual({
      ok: false,
      error: "How often you pay: pick one, so the price makes sense.",
    });
    expect(factsFromForm("other", { coverageSummary: "x".repeat(200) }).ok).toBe(false);
  });

  it("leaves Claude's unreadable facts blank instead of failing", () => {
    expect(
      factsFromClaude("insurance_policy", {
        provider: "State Farm",
        policyType: "spaceship",
        premiumCents: "about 100",
        premiumFrequency: "monthly",
        renewalDate: "next spring",
      }),
    ).toEqual({ ...EMPTY_FACTS, provider: "State Farm", premiumFrequency: "monthly" });
    // A price with no frequency can't be compared, so it's dropped.
    expect(
      factsFromClaude("insurance_policy", { premiumCents: "100", premiumFrequency: "" })
        .premiumCents,
    ).toBeNull();
  });

  it("works out a yearly premium", () => {
    expect(yearlyPremiumCents({ premiumCents: 10_000, premiumFrequency: "monthly" })).toBe(120_000);
    expect(yearlyPremiumCents({ premiumCents: 61_200, premiumFrequency: "semiannual" })).toBe(
      122_400,
    );
    expect(yearlyPremiumCents({ premiumCents: 10_000, premiumFrequency: null })).toBeNull();
    expect(yearlyPremiumCents({ premiumCents: 10_000, premiumFrequency: "weekly" })).toBeNull();
  });

  it("turns stored facts back into form text", () => {
    expect(
      rawFacts({ ...EMPTY_FACTS, premiumCents: 61_200, renewalDate: new Date("2027-03-01") }),
    ).toMatchObject({ premiumCents: "612.00", renewalDate: "2027-03-01", provider: "" });
  });
});
