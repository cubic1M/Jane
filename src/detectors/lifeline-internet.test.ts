import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { LIFELINE, povertyLine } from "@/config/utility-assistance";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// Connectors roadmap round 17: Lifeline and providers' low-income internet plans, "you may qualify".

const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";

const run = (
  topic: string,
  monthlyIncome: number,
  over: Partial<ProfileInput> = {},
  payee = "COMCAST XFINITY",
) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    householdSize: 1,
    told: { ...base.told, monthly_income: monthlyIncome },
    transactions: [
      ...base.transactions.filter(
        (t) => t.pfc !== INTERNET && t.pfc !== "RENT_AND_UTILITIES_TELEPHONE",
      ),
      ...["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
        date,
        amountCents: 7_000,
        description: payee,
        pfc: INTERNET,
        accountId: account,
      })),
    ],
    ...over,
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS).find(
      (s) => s.topic === topic,
    ) ?? null
  );
};

describe("the poverty line", () => {
  it("is USAC's 135% figures, and 200% from the same line", () => {
    expect(povertyLine(1, 1.35)).toBe(2_154_600);
    expect(povertyLine(4, 1.35)).toBe(4_455_000);
    expect(povertyLine(1, 2)).toBe(3_192_000);
  });
});

describe("the Lifeline card", () => {
  it("tells a household under 135% paying for internet it may qualify, $9.25 a month", () => {
    // $1,300 a month take-home is about $20,280: under $21,546 for one.
    const s = run("lifeline", 130_000)!;
    expect(s.worthCents).toBe(LIFELINE.monthlyCents * 12);
    expect(s.why).toContain("$21,546.00");
    expect(s.why).toContain("You apply yourself");
    expect(s.more?.[0]?.href).toBe(LIFELINE.apply);
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("says nothing over the line, without a phone or internet bill, in Alaska or Hawaii, or with no household size", () => {
    expect(run("lifeline", 200_000)).toBeNull();
    expect(
      run("lifeline", 130_000, {
        transactions: inputFor("renter").transactions.filter(
          (t) => t.pfc !== INTERNET && t.pfc !== "RENT_AND_UTILITIES_TELEPHONE",
        ),
      }),
    ).toBeNull();
    expect(run("lifeline", 130_000, { state: "HI" })).toBeNull();
    expect(
      run("lifeline", 130_000, {
        householdSize: null,
        told: { ...inputFor("renter").told, monthly_income: 130_000, household: "family" },
      }),
    ).toBeNull();
  });
});

describe("the low-cost internet card", () => {
  it("names the provider's plan and the saving off what the person pays now", () => {
    // About $31,200 gross for one: under the $31,920 200% line.
    const s = run("low_cost_internet", 200_000)!;
    expect(s.title).toContain("Xfinity");
    expect(s.short).toContain("Internet Essentials, $14.95 a month");
    expect(s.worthCents).toBe((7_000 - 1_495) * 12);
    expect(s.why).toContain("Xfinity decides who qualifies");
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("takes Verizon's discount off, and says nothing for a provider without a listed plan or over the line", () => {
    expect(run("low_cost_internet", 200_000, {}, "VERIZON FIOS")!.worthCents).toBe(3_000 * 12);
    expect(run("low_cost_internet", 200_000, {}, "SONIC INTERNET")).toBeNull();
    expect(run("low_cost_internet", 200_000, {}, "AT&T INTERNET")).toBeNull();
    expect(run("low_cost_internet", 300_000)).toBeNull();
  });
});
