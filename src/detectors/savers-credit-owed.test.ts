import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// The Saver's Credit is nonrefundable (26 USC 25B; Form 8880 limits it to the tax owed). Someone
// whose income is under the standard deduction owes no federal income tax and gets nothing back,
// yet the card said "at least 10% back" and worth $200 to the people least likely to owe it.
// Take-home is grossed up by 1.3, as the card does.

const run = (told: ProfileInput["told"]) => {
  const data: ProfileInput = {
    ...inputFor("renter"),
    today: "2026-11-06",
    told: { ...inputFor("renter").told, ...told },
  };
  // Only the credit's card: the Saver's Match from 2027 is paid into the account whatever tax is
  // owed, so it may still show for these people.
  return (
    runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
      (s) => s.topic === "savers_credit",
    ) ?? null
  );
};

describe("the Saver's Credit card and the tax a person owes", () => {
  it("says nothing to someone under the standard deduction, who owes no income tax", () => {
    // $15,600 single, under $16,100; $31,200 joint, under $32,200; $23,400 head of household,
    // under $24,150.
    expect(run({ monthly_income: 100_000, filing_status: "single" })).toBeNull();
    expect(run({ monthly_income: 200_000, filing_status: "married_joint" })).toBeNull();
    expect(run({ monthly_income: 150_000, filing_status: "head_of_household" })).toBeNull();
  });

  it("is worth no more than the tax owed, and says so", () => {
    // $17,160 single: $1,060 over the deduction, $106 of tax at 10%.
    const s = run({ monthly_income: 110_000, filing_status: "single" })!;
    expect(s.worthCents).toBe(10_600);
    expect(s.why).toContain("can't be more than the federal income tax you owe, about $106.00");
  });

  it("keeps the full 10% of $2,000 when the tax owed covers it", () => {
    const s = run({ monthly_income: 220_000, filing_status: "single" })!;
    expect(s.worthCents).toBe(20_000);
    expect(s.why).not.toContain("can't be more than");
  });
});
