import { describe, expect, it } from "vitest";
import { PLAN_OPTIONS } from "@/config/plan";
import { PlanOptionsError, describePlanOptions, parsePlanOptions } from "./plan-options";

describe("plan options", () => {
  it("keeps only real choices and turns dollars into cents", () => {
    expect(parsePlanOptions("cancel_subscription", { plan: "downgrade", junk: "x" })).toEqual({
      plan: "downgrade",
    });
    expect(parsePlanOptions("negotiate_bill", { targetMonthly: "$85.50" })).toEqual({
      targetMonthly: 8_550,
    });
  });

  it("is null when nothing differs from Jane's defaults", () => {
    expect(parsePlanOptions("cancel_subscription", { plan: "cancel" })).toBeNull();
    expect(parsePlanOptions("negotiate_bill", { targetMonthly: "" })).toBeNull();
    expect(parsePlanOptions("card_interest", { anything: "x" })).toBeNull();
  });

  it("refuses unknown choices and amounts out of range", () => {
    expect(() => parsePlanOptions("cancel_subscription", { plan: "delete" })).toThrow(
      PlanOptionsError,
    );
    expect(() => parsePlanOptions("negotiate_bill", { targetMonthly: "0" })).toThrow(
      PlanOptionsError,
    );
    expect(() => parsePlanOptions("negotiate_bill", { targetMonthly: "lots" })).toThrow(
      PlanOptionsError,
    );
  });

  it("describes the changes in plain words for the team", () => {
    expect(describePlanOptions("cancel_subscription", { plan: "downgrade" })).toEqual([
      "What to do: Switch to a cheaper plan",
    ]);
    expect(describePlanOptions("move_idle_cash", { keepInChecking: 500_000 })).toEqual([
      "Keep this much in checking: $5,000",
    ]);
    expect(describePlanOptions("cancel_subscription", null)).toEqual([]);
  });

  it("gives every choice option a default first choice", () => {
    for (const options of Object.values(PLAN_OPTIONS)) {
      for (const option of options) {
        if (option.kind === "choice") expect(option.choices.length).toBeGreaterThan(1);
      }
    }
  });
});
