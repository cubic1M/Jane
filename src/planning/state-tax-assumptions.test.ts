import { describe, expect, it } from "vitest";
import { STATE_TAX } from "@/config/tax-rates";
import { residentTax } from "./tax-states";

// CodeRabbit sweep 1c, cfg-03 #2 and #4: Mississippi's zero band is in the numbers (its entry said
// "over $10,000" and taxed all of it), and New York's head-of-household assumption is said.

const who = { filingStatus: "single" as const, childrenUnder17: 0, otherDependants: 0 };

describe("Mississippi", () => {
  it("taxes only income over $10,000 at 4%", () => {
    expect(residentTax("MS", 5_000_000, who)?.taxCents).toBe(160_000);
    expect(residentTax("MS", 1_000_000, who)?.taxCents).toBe(0);
    expect(residentTax("MS", 800_000, who)?.taxCents).toBe(0);
  });
});

describe("New York head of household", () => {
  it("is worked out on the single schedule, and the source says so", () => {
    const ny = STATE_TAX.NY;
    expect(ny?.kind).toBe("brackets");
    if (ny?.kind !== "brackets") return;
    expect(ny.brackets.head_of_household).toBe(ny.brackets.single);
    expect(ny.source).toMatch(/head of household is worked out on the single schedule/);
  });
});
