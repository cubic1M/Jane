import { describe, expect, it } from "vitest";
import { daysToEstimatedDate, estimatedDatesBetween } from "./taxes";
import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";

// CodeRabbit sweep 1b (#2258): the April payment is due on the next day that isn't the observed
// Emancipation Day: April 18 in 2022 (the 16th was a Saturday, so Friday the 15th was the
// holiday) and in 2023 (the 16th was a Sunday, so Monday the 17th was).
describe("the April estimated payment date", () => {
  it("is April 18 in 2023, not the observed Emancipation Day", () => {
    expect(daysToEstimatedDate("2023-04-17")).toBe(1);
    expect(daysToEstimatedDate("2023-04-18")).toBe(0);
    expect(estimatedDatesBetween("2023-04-01", "2023-04-17")).toBe(0);
    expect(estimatedDatesBetween("2023-04-01", "2023-04-18")).toBe(1);
  });
  it("is April 18 in 2022, when April 15 was the observed holiday", () => {
    expect(daysToEstimatedDate("2022-04-15")).toBe(3);
    expect(daysToEstimatedDate("2022-04-18")).toBe(0);
  });
  it("stays April 15 in a year with a plain weekday", () => {
    expect(daysToEstimatedDate("2026-04-15")).toBe(0);
  });
});

describe("a Treasurer of State is not a property tax office", () => {
  it("lets Ohio's estimated income tax payments through", () => {
    expect(PROPERTY_TAX_PAYEE.test("OHIO TREASURER OF STATE ESTIMATED TAX")).toBe(false);
    expect(PROPERTY_TAX_PAYEE.test("COUNTY TREASURER")).toBe(true);
  });
});
