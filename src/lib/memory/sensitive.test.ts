import { describe, expect, it } from "vitest";
import { DATA_FACT_KEYS } from "@/config/memory";
import { isSensitiveFact, SENSITIVE_KEYS, sensitiveCategory } from "./sensitive";

// Jane never stores a health, religion, politics, sexual orientation, ethnicity or immigration
// inference, whatever hints at it.

describe("the sensitive-trait deny-list", () => {
  it.each([
    ["health", "Spends a lot at the pharmacy"],
    ["health", "goal:pay off the hospital bill"],
    ["health", "You're pregnant"],
    ["health", "Sees a therapist every week"],
    ["religion", "Gives a tithe to church"],
    ["religion", "Saving for a trip to the mosque"],
    ["politics", "Donates through ActBlue"],
    ["politics", "A Republican donor"],
    ["sexual_orientation", "Goes to LGBTQ events"],
    ["sexual_orientation", "You're gay"],
    ["ethnicity", "Hispanic household"],
    ["ethnicity", "I'm Black"],
    ["immigration", "Paid a USCIS fee for a green card"],
    ["immigration", "On a work visa"],
    ["immigration", "Waiting on citizenship"],
  ] as const)("catches %s in %j", (category, text) => {
    expect(sensitiveCategory(text)).toBe(category);
  });

  it.each([
    "You rent your home",
    "Your main bank is Chase",
    "You pay your Visa card off every month",
    "You're saving for a car",
    "Black Friday deals",
    "You'd rather do things yourself",
    "You work at Acme Corp",
    "You have children at home",
    "conservative investor",
  ])("lets %j through", (text) => {
    expect(sensitiveCategory(text)).toBeNull();
  });

  it("blocks a fact by its key, label or value", () => {
    expect(isSensitiveFact({ key: "health_costs", label: "You spend a lot", value: true })).toBe(
      true,
    );
    expect(isSensitiveFact({ key: "goal:x", label: "Your goal", value: "pay the church" })).toBe(
      true,
    );
    expect(isSensitiveFact({ key: "goal:church_trip", label: "A trip", value: "trip" })).toBe(true);
    expect(isSensitiveFact({ key: "housing", label: "You rent your home", value: "rent" })).toBe(
      false,
    );
  });

  it("never lets the scan remember a sensitive profile fact", () => {
    for (const key of DATA_FACT_KEYS) {
      expect(SENSITIVE_KEYS.has(key), key).toBe(false);
      expect(sensitiveCategory(key), key).toBeNull();
    }
  });
});
