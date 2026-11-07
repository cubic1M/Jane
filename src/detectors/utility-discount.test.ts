import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CA_CARE_FERA, caLimit } from "@/config/utility-assistance";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// Connectors roadmap round 17: California's CARE and FERA energy discounts, "you may qualify".

const run = (over: Partial<ProfileInput>, monthlyIncome: number) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    today: "2026-11-06",
    state: "CA",
    householdSize: 1,
    told: { ...base.told, monthly_income: monthlyIncome },
    transactions: [
      ...base.transactions.filter((t) => t.pfc !== "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"),
      ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => ({
        date,
        amountCents: 10_000,
        description: "PG&E",
        pfc: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
        accountId: account,
      })),
    ],
    ...over,
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS).find(
      (s) => s.topic === "utility_discount",
    ) ?? null
  );
};

describe("the CARE and FERA limits", () => {
  it("share one row for 1-2 people and add the extra past 8", () => {
    expect(caLimit(CA_CARE_FERA.care, 1)).toBe(4_328_000);
    expect(caLimit(CA_CARE_FERA.care, 2)).toBe(4_328_000);
    expect(caLimit(CA_CARE_FERA.care, 4)).toBe(6_600_000);
    expect(caLimit(CA_CARE_FERA.care, 10)).toBe(11_144_000 + 2 * 1_136_000);
    expect(caLimit(CA_CARE_FERA.fera, 3)).toBe(6_830_000);
  });
});

describe("the CARE and FERA hint", () => {
  it("tells a California household under the CARE limit it may qualify, worth 20% of its energy bills", () => {
    // $2,500 a month take-home is about $39,000 gross: under $43,280 for one person.
    const s = run({}, 250_000)!;
    expect(s.title).toContain("CARE");
    expect(s.why).toContain("$43,280.00");
    expect(s.why).toContain("Your utility decides");
    expect(s.more?.[0]?.href).toBe(CA_CARE_FERA.care.url);
    // Worth 20% of the year of gas and electric the card states.
    const yearly = /on your \$([\d,]+\.\d{2}) a year of gas and electric/.exec(s.why)!;
    const yearlyCents = Math.round(Number(yearly[1]!.replace(/,/g, "")) * 100);
    expect(yearlyCents).toBeGreaterThan(0);
    expect(s.worthCents).toBe(Math.round(yearlyCents * CA_CARE_FERA.care.lowestDiscount));
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("offers FERA to a household of three just over CARE, and nothing over FERA", () => {
    // About $62,400 gross for three: over CARE's $54,640, under FERA's $68,300.
    expect(run({ householdSize: 3 }, 400_000)!.title).toContain("FERA");
    // FERA needs three or more: two people over CARE get nothing.
    expect(run({ householdSize: 2 }, 400_000)).toBeNull();
    expect(run({ householdSize: 3 }, 600_000)).toBeNull();
  });

  it("says nothing outside California, without the household size, or outside the table's dates", () => {
    expect(run({ state: "NY" }, 250_000)).toBeNull();
    expect(run({ state: null }, 250_000)).toBeNull();
    expect(run({ householdSize: null }, 250_000)).toBeNull();
    expect(run({ today: "2027-06-01" }, 250_000)).toBeNull();
  });
});
