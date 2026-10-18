import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { NEVER_BY_RULE, STANDING_RULES } from "@/config/rules";
import { ACTION_FOR_FINDING } from "@/lib/cards";
import { matchingRule, type SavedRule } from "./standing-rules";

const rule = (key: string, extra: Partial<SavedRule> = {}): SavedRule => ({
  key,
  enabled: true,
  monthlyLimit: 3,
  maxAnnualCents: null,
  ...extra,
});

describe("standing rules", () => {
  it("never cover moving money, phone calls, cancelling or insurance", () => {
    for (const definition of STANDING_RULES) {
      for (const type of definition.findingTypes) {
        expect(NEVER_BY_RULE).not.toContain(ACTION_FOR_FINDING[type]);
      }
    }
    expect(new Set(STANDING_RULES.map((r) => r.key)).size).toBe(STANDING_RULES.length);
  });

  it("approves a finding only with an enabled rule for its type", () => {
    const fee = { type: "bank_fees" as const, annualSavingsCents: 3_400 };
    expect(matchingRule(fee, [rule("recover_bank_fees")])?.key).toBe("recover_bank_fees");
    expect(matchingRule(fee, [rule("recover_bank_fees", { enabled: false })])).toBeNull();
    expect(matchingRule(fee, [rule("refund_double_charges")])).toBeNull();
    expect(
      matchingRule({ type: "trial_conversion", annualSavingsCents: 12_000 }, [
        rule("refund_unwanted_charges"),
      ])?.key,
    ).toBe("refund_unwanted_charges");
  });

  it("keeps to the amount on rules that have one", () => {
    const rules = [rule("fight_price_increases", { maxAnnualCents: 5_000 })];
    expect(
      matchingRule({ type: "price_increase", annualSavingsCents: 3_000 }, rules),
    ).not.toBeNull();
    expect(matchingRule({ type: "price_increase", annualSavingsCents: 6_000 }, rules)).toBeNull();
    expect(matchingRule({ type: "price_increase", annualSavingsCents: null }, rules)).toBeNull();
  });

  it("never matches a finding whose action always needs a yes, whatever is saved", () => {
    // Even a made-up saved rule naming these types can't approve them.
    for (const type of [
      "idle_cash",
      "bill_negotiation",
      "insurance_reshop",
      "subscription_review",
    ] as const) {
      expect(
        matchingRule({ type, annualSavingsCents: 100 }, [rule("recover_bank_fees")]),
      ).toBeNull();
    }
  });
});
