import { describe, expect, it } from "vitest";
import { AUTOPILOT_LEVELS, AUTOPILOT_ORDER, AUTOPILOT_RECOMMENDED } from "./autopilot";
import { RULE_MONTHLY_LIMITS, STANDING_RULES } from "./rules";

describe("autopilot levels", () => {
  it("only switch on standing rules, within the allowed monthly limits", () => {
    const keys = new Set(STANDING_RULES.map((r) => r.key));
    for (const level of Object.values(AUTOPILOT_LEVELS)) {
      for (const [key, rule] of Object.entries(level.rules)) {
        expect(keys.has(key), key).toBe(true);
        expect(RULE_MONTHLY_LIMITS).toContain(rule.limit);
      }
    }
  });

  it("offers every level once, the recommended one first", () => {
    expect([...AUTOPILOT_ORDER].sort()).toEqual(Object.keys(AUTOPILOT_LEVELS).sort());
    expect(AUTOPILOT_ORDER[0]).toBe(AUTOPILOT_RECOMMENDED);
    expect(Object.keys(AUTOPILOT_LEVELS.ask.rules)).toEqual([]);
  });
});
