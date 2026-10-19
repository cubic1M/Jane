import { describe, expect, it } from "vitest";
import { INFLATION, RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import {
  CATCH_UP_CENTS,
  EMPLOYEE_DEFERRAL_LIMIT_CENTS,
  RETIREMENT_AGE,
  SUPER_CATCH_UP_CENTS,
  TARGET_TIMES_PAY,
} from "@/config/retirement";
import { checkGuardrails } from "@/lib/guardrails";
import {
  catchUpFor,
  futureValue,
  retirementPlan,
  rothOrTraditional,
  yearlyToClose,
  type RetirementInput,
} from "./retirement";

// Spec step 132: on track for retirement? Assumptions in config; a range, never a promise.

const DEMO: RetirementInput = {
  age: 45,
  balanceCents: 8_425_040,
  employeeCents: 326_400,
  employerCents: 163_200,
  plan: { payCents: 8_160_000, matchRate: 0.5, matchUpTo: 0.06 },
};
const real = (n: number) => (1 + n) / (1 + INFLATION.value) - 1;

describe("the math", () => {
  it("grows a balance and yearly contributions", () => {
    // $10,000 and $1,000 a year for 10 years at 5%: 10,000 × 1.05¹⁰ + 1,000 × (1.05¹⁰ − 1)/0.05.
    expect(futureValue(1_000_000, 100_000, 10, 0.05)).toBe(2_886_684);
    expect(futureValue(1_000_000, 100_000, 10, 0)).toBe(2_000_000);
    expect(futureValue(1_000_000, 100_000, 0, 0.05)).toBe(1_000_000);
  });

  it("finds the yearly amount that closes a gap", () => {
    expect(yearlyToClose(1_000_000, 10, 0.05)).toBe(79_505);
    expect(yearlyToClose(1_000_000, 10, 0)).toBe(100_000);
    expect(yearlyToClose(-5, 10, 0.05)).toBe(0);
  });

  it("knows the catch-up at each age", () => {
    expect([49, 50, 59, 60, 63, 64].map(catchUpFor)).toEqual([
      0,
      CATCH_UP_CENTS,
      CATCH_UP_CENTS,
      SUPER_CATCH_UP_CENTS,
      SUPER_CATCH_UP_CENTS,
      CATCH_UP_CENTS,
    ]);
  });

  it("picks Roth at lower pay, traditional at higher, a mix between", () => {
    expect(rothOrTraditional(5_000_000)).toBe("roth");
    expect(rothOrTraditional(8_160_000)).toBe("mix");
    expect(rothOrTraditional(30_000_000)).toBe("traditional");
    expect(rothOrTraditional(null)).toBeNull();
  });
});

describe("retirementPlan on the demo person", () => {
  const plan = retirementPlan(DEMO);

  it("projects a range in today's dollars from the low and high returns", () => {
    const yearly = DEMO.employeeCents + DEMO.employerCents;
    expect(plan.years).toBe(RETIREMENT_AGE - 45);
    expect(plan.projection).toEqual({
      lowCents: futureValue(DEMO.balanceCents, yearly, 22, real(RETURN_LOW.value)),
      highCents: futureValue(DEMO.balanceCents, yearly, 22, real(RETURN_HIGH.value)),
    });
    expect(plan.projection.lowCents).toBeLessThan(plan.projection.highCents);
    expect(plan.targetCents).toBe(8_160_000 * TARGET_TIMES_PAY);
    expect(plan.status).toBe("behind");
  });

  it("finds the missed match and says how to get all of it", () => {
    expect(plan.match).toEqual({
      employeeRate: 0.04,
      captured: false,
      missedCents: 81_600,
      fullMatchRate: 0.06,
    });
    expect(plan.changes[0]).toMatchObject({
      what: "Raise your 401(k) contribution from 4% to 6% of your pay.",
      why: "Your employer adds 50% of what you put in, on up to 6% of your pay. At 4% you leave about $816 a year of their money on the table.",
      extraYearlyCents: 163_200,
    });
    expect(plan.roomCents).toBe(EMPLOYEE_DEFERRAL_LIMIT_CENTS - 326_400);
    expect(plan.rothOrTraditional).toBe("mix");
  });

  it("suggests saving more within the limits and a tenth of pay", () => {
    const more = plan.changes[1];
    expect(more.extraYearlyCents).toBe(816_000);
    expect(more.what).toBe("Put in about $8,160 more a year (10% of your pay).");
    expect(more.why).toMatch(/^It's a step towards the target of \$816,000 by 67/);
  });

  it("never promises, and names only figures it records", () => {
    for (const c of plan.changes) {
      const text = `${c.what} ${c.why}`;
      expect(checkGuardrails(text, c.figures, undefined, "demo_advice"), text).toEqual({
        ok: true,
      });
    }
  });

  it("is on track with enough saved, and quiet about the match once it's all captured", () => {
    const rich = retirementPlan({
      ...DEMO,
      balanceCents: 90_000_000,
      employeeCents: 489_600,
      employerCents: 244_800,
    });
    expect(rich.status).toBe("on_track");
    expect(rich.match?.captured).toBe(true);
    expect(rich.changes).toEqual([]);
  });

  it("can't say on track without the person's pay, and adds catch-up from 50", () => {
    const unknown = retirementPlan({ ...DEMO, plan: null });
    expect(unknown).toMatchObject({
      status: "unknown",
      targetCents: null,
      match: null,
      rothOrTraditional: null,
    });
    const older = retirementPlan({ ...DEMO, age: 55 });
    expect(older.catchUpCents).toBe(CATCH_UP_CENTS);
    expect(older.changes.at(-1)?.what).toBe(
      "Use catch-up contributions: from 50 you can put in $8,000 a year above the usual limit.",
    );
    expect(retirementPlan({ ...DEMO, age: 70 }).years).toBe(0);
  });
});
