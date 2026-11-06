import { describe, expect, it } from "vitest";
import { CASH_HOMES } from "@/config/cash";
import { emergencyHome } from "./cash";

// FDIC insurance and government backing are two things (12 CFR 328.102; connectors roadmap round
// 13): a Treasury is backed by the US government and is not FDIC insured.

describe("where cash can sit", () => {
  it("never calls a Treasury FDIC insured", () => {
    const treasury = CASH_HOMES.find((h) => h.key === "treasury_ladder")!;
    expect(treasury).toMatchObject({ fdicInsured: false, governmentBacked: true });
    expect(treasury.note).toMatch(/not FDIC insured/);
  });

  it("only says FDIC insured of a home that is", () => {
    for (const home of CASH_HOMES) {
      const says = /(?<!not )FDIC insured/i.test(home.note);
      expect(says, home.key).toBe(home.fdicInsured);
      expect(home.fdicInsured && home.governmentBacked, home.key).toBe(false);
    }
  });

  it("still keeps the emergency fund in high-yield savings", () => {
    expect(emergencyHome().key).toBe("high_yield_savings");
  });
});
