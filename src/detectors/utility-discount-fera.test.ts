import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// CodeRabbit sweep 1b: FERA discounts electricity only, but the saving was worked on every energy
// bill, gas included.
const run = (payee: string) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    today: "2026-11-06",
    state: "CA",
    householdSize: 3,
    told: { ...base.told, monthly_income: 400_000 },
    transactions: [
      ...base.transactions.filter((t) => t.pfc !== "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"),
      ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => ({
        date,
        amountCents: 10_000,
        description: payee,
        pfc: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
        accountId: account,
      })),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS).find(
    (s) => s.topic === "utility_discount",
  )!;
};

describe("the FERA hint", () => {
  it("has no dollar figure on gas-only bills", () => {
    const s = run("SOCALGAS");
    expect(s.title).toContain("FERA");
    expect(s.worthCents).toBe(0);
    expect(s.why).toMatch(/can't tell which of your energy bills are electric/);
  });
  it("has no dollar figure on a gas bill from a utility that sells both", () => {
    const s = run("PG&E GAS");
    expect(s.worthCents).toBe(0);
    expect(s.why).toMatch(/can't tell which of your energy bills are electric/);
  });
  it("is worked on electric bills", () => {
    const s = run("PG&E ELECTRIC");
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.why).toMatch(/a year of electric, at least/);
  });
});
