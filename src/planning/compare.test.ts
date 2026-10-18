import { describe, expect, it } from "vitest";
import { checkGuardrails } from "@/lib/guardrails";
import { compareOptions, type CompareOption } from "./compare";

const option = (overrides: Partial<CompareOption>): CompareOption => ({
  id: "o",
  kind: "plan",
  category: "phone",
  merchantKey: null,
  provider: "Pine Mobile",
  name: "Pine Unlimited",
  monthlyCents: 3_500,
  apyBps: null,
  contractMonths: 0,
  oneTimeFeeCents: 0,
  minimumBalanceCents: 0,
  includes: null,
  givesUp: null,
  signUpUrl: null,
  sourceUrl: "https://example.com",
  checkedAt: "2026-10-18",
  demo: false,
  ...overrides,
});

const phone = {
  kind: "bill",
  monthlyCents: 14_500,
  category: "phone",
  merchantKey: "verizon wireless",
} as const;

describe("comparing options", () => {
  it("picks the lowest first-year cost for the same kind of service, fees included", () => {
    const result = compareOptions(phone, [
      option({ id: "cheap-with-fee", monthlyCents: 3_000, oneTimeFeeCents: 10_000 }),
      option({ id: "cheap", monthlyCents: 3_500 }),
      option({ id: "mid", monthlyCents: 5_500 }),
      option({ id: "internet", category: "internet_tv", monthlyCents: 1_000 }),
      option({ id: "same-provider", merchantKey: "verizon wireless", monthlyCents: 2_000 }),
      option({ id: "dearer", monthlyCents: 16_000 }),
    ])!;
    // $30 + $100 fee = $460 in year one; $35 = $420.
    expect(result.pick.option.id).toBe("cheap");
    expect(result.pick.savingCents).toBe(14_500 * 12 - 3_500 * 12);
    expect(result.runnersUp.map((s) => s.option.id)).toEqual(["cheap-with-fee", "mid"]);
    expect(result.currentYearCents).toBe(174_000);
    expect(result.runnersUp[0].notes).toContain("$100 one-time fee");
  });

  it("prefers no contract when the saving is the same", () => {
    const result = compareOptions(phone, [
      option({ id: "contract", contractMonths: 24 }),
      option({ id: "free" }),
    ])!;
    expect(result.pick.option.id).toBe("free");
    expect(result.runnersUp[0].notes).toEqual(["24-month contract"]);
  });

  it("compares a subscription with its own cheaper tiers only", () => {
    const netflix = {
      kind: "bill",
      monthlyCents: 1_799,
      category: null,
      merchantKey: "netflix",
    } as const;
    const result = compareOptions(netflix, [
      option({
        id: "ads",
        kind: "tier",
        merchantKey: "netflix",
        monthlyCents: 799,
        givesUp: "Has ads",
      }),
      option({ id: "hulu", kind: "tier", merchantKey: "hulu", monthlyCents: 100 }),
      option({ id: "phone", monthlyCents: 100 }),
    ])!;
    expect(result.pick.option.id).toBe("ads");
    expect(result.pick.notes).toEqual(["Has ads"]);
    expect(result.runnersUp).toEqual([]);
  });

  it("ignores options that save too little to be worth a switch", () => {
    expect(compareOptions(phone, [option({ monthlyCents: 14_400 })])).toBeNull();
    expect(compareOptions(phone, [])).toBeNull();
  });

  it("picks the savings account that earns the most, among those they qualify for", () => {
    const cash = { kind: "savings", amountCents: 1_500_000, currentRateBps: 50 } as const;
    const result = compareOptions(cash, [
      option({
        id: "meadow",
        kind: "savings",
        category: "savings",
        monthlyCents: null,
        apyBps: 410,
      }),
      option({
        id: "cobalt",
        kind: "savings",
        category: "savings",
        monthlyCents: null,
        apyBps: 435,
        minimumBalanceCents: 2_000_000,
      }),
      option({
        id: "granite",
        kind: "savings",
        category: "savings",
        monthlyCents: null,
        apyBps: 375,
      }),
    ])!;
    expect(result.pick.option.id).toBe("meadow");
    // $15,000 at 4.10% is $615; at 0.50% it's $75.
    expect(result.pick.firstYearCents).toBe(61_500);
    expect(result.pick.savingCents).toBe(54_000);
    expect(result.runnersUp.map((s) => s.option.id)).toEqual(["granite"]);
    expect(result.why).toContain("$15,000");
  });

  it("says why in words that pass Jane's guardrails", () => {
    for (const current of [
      phone,
      { kind: "savings", amountCents: 1_500_000, currentRateBps: 50 } as const,
    ]) {
      const result = compareOptions(current, [
        option({
          monthlyCents: 3_500,
          apyBps: 410,
          kind: current.kind === "bill" ? "plan" : "savings",
          category: current.kind === "bill" ? "phone" : "savings",
        }),
      ])!;
      expect(checkGuardrails(result.why, [1_500_000]), result.why).toEqual({ ok: true });
    }
  });
});
