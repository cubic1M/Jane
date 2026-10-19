import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DEMO_EMPLOYER, demoPaystubs } from "@/data-sources/demo/demo-payroll";
import { parseIntent } from "@/lib/jane-agent/intents";
import { foundBody, QUESTIONS } from "@/lib/jane-agent/insurance/benefit-words";
import { benefitOf, nextQuestion, yearlyCost, yearlyPay, type Benefit } from "./benefits";
import { reviewRecommendations, type BenefitComparison } from "./benefits-review";

// Benefits through work (spec step 150): deductions read by their labels, the guided
// questions, and the comparison with buying the same cover privately. Pure.

const benefit = (over: Partial<Benefit> = {}): Benefit => ({
  id: "b1",
  employer: "ACME CORP",
  kind: "life",
  label: "SUPP LIFE 1X",
  perPayCents: 850,
  payFrequency: "semimonthly",
  details: {},
  status: "found",
  source: "paystub",
  policyId: null,
  ...over,
});

describe("reading the pay stub", () => {
  it.each([
    ["MEDICAL PPO EE+1", "health"],
    ["HDHP FAMILY", "health"],
    ["DENTAL", "dental"],
    ["VISION", "vision"],
    ["SUPP LIFE 1X", "life"],
    ["AD&D", "life"],
    ["LTD", "disability"],
    ["STD", "disability"],
    ["HSA EE", "hsa"],
    ["FSA HC", "fsa"],
    ["401K 6%", null],
    ["FED TAX", null],
  ])("reads %j as %s", (label, kind) => {
    expect(benefitOf(label)).toBe(kind);
  });

  it("gives the demo bank's paydays with the demo bank's net pay", () => {
    const [latest, before] = demoPaystubs(new Date("2026-10-19T12:00:00Z"));
    expect([latest.payDate, before.payDate]).toEqual(["2026-10-15", "2026-10-01"]);
    expect(latest).toMatchObject({
      employer: DEMO_EMPLOYER,
      netCents: 245_000,
      payFrequency: "semimonthly",
    });
    expect(latest.openEnrollment).toEqual({ start: "2026-11-02", end: "2026-11-13" });
    expect(demoPaystubs(new Date("2026-12-01T12:00:00Z"))[0].openEnrollment?.end).toBe(
      "2027-11-13",
    );
    expect(yearlyPay(latest)).toBe(8_640_000);
  });

  it("works out a benefit's cost a year", () => {
    expect(yearlyCost(benefit())).toBe(20_400);
  });
});

describe("the guided questions", () => {
  it("asks about life cover the employer pays for, then disability unless the stub shows it", () => {
    expect(nextQuestion([])).toBe("life");
    expect(nextQuestion([benefit({ source: "asked" })])).toBe("disability");
    expect(
      nextQuestion([
        benefit({ source: "asked" }),
        benefit({ id: "d", kind: "disability", label: "LTD" }),
      ]),
    ).toBeNull();
    expect(
      nextQuestion([
        benefit({ source: "asked" }),
        benefit({ id: "d", kind: "disability", source: "asked", status: "unsure" }),
      ]),
    ).toBeNull();
  });

  it("says what was found, and only counts it once confirmed", () => {
    expect(
      foundBody([
        benefit(),
        benefit({ id: "h", kind: "hsa", label: "HSA EE", perPayCents: 10_000 }),
      ]).split("\n"),
    ).toEqual([
      "I found 2 benefits on your ACME CORP pay stub.",
      "- Life insurance: $8.50 a paycheck ($204.00 a year)",
      "- Health savings account (HSA): $100.00 a paycheck ($2,400.00 a year)",
      "Are these right? They only count on your insurance once you confirm them.",
    ]);
    expect(QUESTIONS.life.actions.map((a) => a.id)).toEqual([
      "benefits.life_1x",
      "benefits.life_2x",
      "benefits.life_none",
      "benefits.unsure",
    ]);
  });

  it("reads questions about benefits through work", () => {
    for (const text of [
      "what benefits do I get through work",
      "my work benefits",
      "when is open enrollment",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({
        kind: "insurance",
        ask: "benefits",
      });
    }
  });
});

describe("through work or on your own", () => {
  const comparison = (over: Partial<BenefitComparison>): BenefitComparison => ({
    benefit: benefit({ status: "confirmed", policyId: "p" }),
    throughWorkCents: 20_400,
    privateCents: 17_000,
    privateName: "Bluepeak Mutual (demo)",
    note: null,
    ...over,
  });

  it("keeps a benefit that's cheaper through work, with both prices", () => {
    const [rec] = reviewRecommendations([comparison({ privateCents: 30_000 })]);
    expect(rec).toMatchObject({
      key: "benefit_keep",
      title: "Keep your life insurance through ACME CORP.",
      cost: "About $204.00 a year",
    });
    expect(rec.risk).toBe(
      "The same cover privately starts at $300.00 a year, so work is the better price. It ends if you leave the job.",
    );
  });

  it("suggests buying privately when the same cover costs enough less", () => {
    const [rec] = reviewRecommendations([
      comparison({ throughWorkCents: 40_000, privateCents: 17_000 }),
    ]);
    expect(rec).toMatchObject({
      key: "benefit_private",
      costCents: -23_000,
      cost: "Saves about $230.00 a year",
    });
  });

  it("says why when it can't compare like for like", () => {
    const [rec] = reviewRecommendations([
      comparison({
        privateCents: null,
        privateName: null,
        note: "Add your work plan's deductible.",
      }),
    ]);
    expect(rec).toMatchObject({ key: "benefit_details", risk: "Add your work plan's deductible." });
  });
});
