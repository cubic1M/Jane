import { describe, expect, it } from "vitest";
import { ROLLOVER_NOTE } from "@/config/old-accounts";
import { arrivesOn, feeComparison, isComplete, olderPlans, stepsOn, yearlyFee } from "./rollover";

// Spec step 211: fees before and after, and the tracked steps of a direct rollover.

describe("fees compared", () => {
  it("is balance times expense ratio, before and after (the demo plan: $38,200 at 1.12% to 0.03%)", () => {
    expect(yearlyFee(3_820_000, 112)).toBe(42_784);
    expect(feeComparison({ balanceCents: 3_820_000, oldBps: 112, newBps: 3 })).toEqual({
      beforeCents: 42_784,
      afterCents: 1_146,
      savedCents: 41_638,
    });
  });
});

describe("the rollover steps", () => {
  it("are done in order: ready and requested at once, the money 3 days later", () => {
    const day0 = stepsOn("2026-10-18", "2026-10-18");
    expect(day0.map((s) => [s.key, s.doneOn])).toEqual([
      ["destination", "2026-10-18"],
      ["request", "2026-10-18"],
      ["arrives", null],
      ["invested", null],
    ]);
    expect(isComplete(day0)).toBe(false);
    expect(isComplete(stepsOn("2026-10-18", "2026-10-20"))).toBe(false);
    const landed = stepsOn("2026-10-18", "2026-10-21");
    expect(isComplete(landed)).toBe(true);
    expect(landed[2].doneOn).toBe("2026-10-21");
    expect(arrivesOn("2026-10-18")).toBe("2026-10-21");
  });
  it("is direct: the plan sends it, never a check to the person, and a Roth is never the target", () => {
    expect(stepsOn("2026-10-18", "2026-10-18")[1].label).toMatch(/the plan sends it, not you/);
    expect(ROLLOVER_NOTE).toMatch(/isn't a withdrawal and isn't taxed/);
    expect(ROLLOVER_NOTE).toMatch(/Jane never does that/);
  });
});

describe("401(k)s linked from past jobs", () => {
  const plan = (id: string, balanceCents: number) => ({ id, name: id, balanceCents });
  it("are every linked 401(k) but the biggest, with the yearly saving at the fee gap", () => {
    const older = olderPlans([plan("now", 41_155_000), plan("old", 2_389_200)], 50);
    expect(older.plans.map((p) => p.id)).toEqual(["old"]);
    expect(older).toMatchObject({ count: 2, totalCents: 2_389_200, savedCents: 11_946 });
  });
  it("are none with one plan, and leave out empty ones", () => {
    expect(olderPlans([plan("now", 100_000)], 50).plans).toEqual([]);
    expect(olderPlans([plan("now", 100_000), plan("empty", 0)], 50).totalCents).toBe(0);
  });
});
