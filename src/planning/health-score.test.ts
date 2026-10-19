import { describe, expect, it } from "vitest";
import { HEALTH_NEVER_SAY, HEALTH_WEIGHTS } from "@/config/health-score";
import { bandOf, healthChange, healthScore, type HealthInput } from "./health-score";

// Spec step 146, pure: a score out of 100 from weighted parts, each explained, with parts
// Jane can't see left out rather than counted against the person, and never a word that
// judges.

const strong: HealthInput = {
  cashCents: 1_500_000,
  monthlySpendingCents: 400_000,
  monthlyIncomeCents: 600_000,
  slips: 0,
  cardBalanceCents: 0,
  goals: { onTrack: 2, total: 2 },
};

describe("healthScore", () => {
  it("weights add up to 100", () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
  });

  it("gives full points, and no next steps, when every part is full", () => {
    const score = healthScore(strong)!;
    expect(score).toMatchObject({ score: 100, band: "Strong", left: [] });
    expect(score.parts.every((p) => p.points === p.max && p.next === null)).toBe(true);
  });

  it("explains each part and what would raise it", () => {
    const score = healthScore({
      ...strong,
      cashCents: 600_000,
      monthlyIncomeCents: 440_000,
      slips: 1,
      cardBalanceCents: 220_000,
      goals: { onTrack: 1, total: 2 },
    })!;
    const by = Object.fromEntries(score.parts.map((p) => [p.part, p]));
    expect(by.cushion).toMatchObject({
      points: 13,
      why: "Your cash would cover about 1.5 months of spending.",
    });
    expect(by.margin.why).toBe("About 9% of what comes in is left after spending (last 3 months).");
    expect(by.onTime).toMatchObject({
      points: 13,
      why: "1 late or overdraft fee in the last 90 days.",
    });
    expect(by.cards).toMatchObject({ points: 8 });
    expect(by.cards.why).toBe("Card balances of $2,200.00, about 0.5 months of income.");
    expect(by.goals).toMatchObject({ points: 8, why: "1 of 2 savings goals on track." });
    expect(score.parts.every((p) => p.next)).toBe(true);
    expect(score.score).toBe(53);
    expect(score.band).toBe("Building");
  });

  it("leaves out what it can't see and scales over the rest", () => {
    const score = healthScore({
      ...strong,
      cardBalanceCents: null,
      goals: { onTrack: 0, total: 0 },
    })!;
    expect(score.score).toBe(100);
    expect(score.left.map((l) => l.part)).toEqual(["cards", "goals"]);
    expect(
      healthScore({
        ...strong,
        cashCents: null,
        monthlySpendingCents: null,
        monthlyIncomeCents: null,
        slips: null,
        cardBalanceCents: null,
        goals: { onTrack: 0, total: 0 },
      }),
    ).toBeNull();
  });

  it("says spending above income plainly, without a verdict", () => {
    const score = healthScore({ ...strong, monthlySpendingCents: 660_000 })!;
    expect(score.parts.find((p) => p.part === "margin")).toMatchObject({
      points: 0,
      why: "Spending ran about 10% above what came in over the last 3 months.",
    });
  });

  it("never judges, whatever the numbers", () => {
    for (const cash of [null, 0, 50_000, 5_000_000]) {
      for (const spending of [null, 100_000, 900_000]) {
        for (const slips of [null, 0, 4]) {
          for (const cards of [null, 0, 3_000_000]) {
            const score = healthScore({
              cashCents: cash,
              monthlySpendingCents: spending,
              monthlyIncomeCents: 500_000,
              slips,
              cardBalanceCents: cards,
              goals: { onTrack: 0, total: 3 },
            });
            const text = [
              score?.band,
              ...(score?.parts ?? []).flatMap((p) => [p.label, p.why, p.next ?? ""]),
              ...(score?.left ?? []).map((l) => l.why),
            ].join(" ");
            expect(text).not.toMatch(HEALTH_NEVER_SAY);
          }
        }
      }
    }
  });
});

describe("bands and change", () => {
  it("names bands kindly", () => {
    expect([bandOf(95), bandOf(70), bandOf(10)]).toEqual(["Strong", "Steady", "Building"]);
  });

  it("says how far it moved and which part moved it most", () => {
    const now = healthScore(strong)!;
    const before = healthScore({ ...strong, cashCents: 400_000 })!;
    expect(healthChange(now, before)).toEqual({
      delta: now.score - before.score,
      biggest: { label: "Cash cushion", delta: 25 - before.parts[0].points },
    });
    expect(healthChange(now, now)).toEqual({ delta: 0, biggest: null });
  });
});
