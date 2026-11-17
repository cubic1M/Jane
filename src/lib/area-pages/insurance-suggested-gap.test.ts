import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";
import { landing } from "./landing";

// Debug 2, third desktop sweep (11-16, upload S4: Chase checking with gas charges, no car on the
// profile): Yes on "Check your car is insured, protect $100,000" opened Insurance's "Cover that
// looks missing", which listed renters and health cover, nothing about a car. An open suggestion
// about missing cover is listed there when the profile's gaps don't show it.

const base: InsuranceTreeInput = {
  asOf: "2026-11-16",
  needs: [],
  policies: [],
  gaps: [
    { key: "renters", why: "Your payments show rent.", policyId: null },
    { key: "health", why: "There's no health plan on your profile.", policyId: null },
  ],
  savings: [],
  renewals: [],
  changes: [],
  readings: [],
  payingTwice: [],
  cards: [],
  household: [],
  risks: [],
  health: null,
};
const missing = (input: InsuranceTreeInput) =>
  insuranceTree(input).tree.branches.find((b) => b.id === "missing")?.items ?? [];

describe("cover Jane suggests checking", () => {
  it("is listed under what looks missing, as its own item", () => {
    const items = missing({
      ...base,
      suggested: [{ topic: "auto_insurance", short: "Your gas charges suggest a car." }],
    });
    expect(items.map((i) => i.id)).toEqual(["missing:renters", "missing:health", "missing:auto"]);
    expect(items.at(-1)).toMatchObject({ label: "Car insurance", figure: "Check it" });
  });

  it("isn't listed twice when the profile shows the gap too", () => {
    const items = missing({
      ...base,
      suggested: [{ topic: "renters_insurance", short: "Your payments show rent." }],
    });
    expect(items.filter((i) => i.id === "missing:renters")).toHaveLength(1);
  });

  it("is where a bare link to Insurance lands", () => {
    expect(
      landing("/insurance", { key: "insurance:auto_insurance", topic: "auto_insurance" }),
    ).toBe("/insurance?focus=missing:auto");
  });
});
