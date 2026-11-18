import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { decidesLine } from "@/lib/questions";
import { bestQuestion } from "@/profile/questions";
import { STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { SIDE_INCOME_DETECTORS } from "./side-income";
import { runDetectors, type Suggestion } from "./index";

// Side income beside a paycheck (suggest-taxes phase 2, the gap pass): the walk's checking-only person
// takes Stripe payouts and Venmo cash-outs besides an employer's pay.

const walk = (told: Told = {}) =>
  inputFromStatements(
    [{ name: "checking.csv", text: readFileSync("e2e/fixtures/messy/checking.csv", "utf8") }],
    STUDENT_TODAY,
    told,
  );
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, SIDE_INCOME_DETECTORS)[0] ?? null;
const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const person = (rows: ReturnType<typeof tx>[], told: Told = {}): ProfileInput => ({
  today: STUDENT_TODAY,
  transactions: [
    ...["2026-08-20", "2026-09-20", "2026-10-20", "2026-11-15"].map((d) =>
      tx(d, 6_000, "SAFEWAY MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
    ),
    ...rows,
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 100_000 }],
  liabilities: [],
  told,
});
const pay = [
  "2026-08-29",
  "2026-09-12",
  "2026-09-26",
  "2026-10-10",
  "2026-10-24",
  "2026-11-07",
].map((d) => tx(d, -200_000, "ACME CORP PAYROLL", "INCOME_SALARY"));
const plain = (s: Suggestion) => {
  for (const t of [s.title, s.headline, s.short, s.why]) {
    expect(
      checkGuardrails(
        t,
        dollarFigures(t).map((f) => f.cents),
      ),
      t,
    ).toEqual({ ok: true });
    expect(tellsThemToAct(t), t).toBe(false);
    expect(recommendsAChoice(t), t).toBe(false);
  }
};

describe("side income beside a paycheck", () => {
  it("finds the walk person's Stripe payouts, leaving Venmo out until they say what it is", async () => {
    const s = run(await walk())!;
    expect(s.short).toContain("$1,760.00 from Stripe");
    expect(s.why).toContain("left out of this figure");
    expect(s.why).toContain("15.3%");
    expect(s.why).toContain("$20,000 and 200 payments");
    plain(s);
    const work = run(await walk({ app_income: "work" }))!;
    expect(work.short).toContain("$1,965.50");
    expect(work.worthCents).toBeGreaterThan(s.worthCents);
    expect(run(await walk({ app_income: "friends" }))!.worthCents).toBe(s.worthCents);
  });

  it("asks what the payment-app money is, saying what it decides", async () => {
    const data = await walk();
    const best = bestQuestion(buildProfile(data), data, new Set())!;
    expect(best.spec.fact).toBe("app_income");
    expect(decidesLine(best.spec, best.decidesCount, best.unlockCents)).toMatch(
      /^It decides a tax figure worth up to \$[\d,]+ for you\.$/,
    );
  });

  it("is the self-employment tax plus income tax at their rate on the year's pace", () => {
    const stripe = ["2026-09-05", "2026-10-05", "2026-11-05"].map((d) =>
      tx(d, -50_000, "STRIPE TRANSFER", "INCOME_CONTRACTOR"),
    );
    const s = run(person([...pay, ...stripe]))!;
    expect(s.worthCents).toBeGreaterThan(0);
    // $50 a month is about $200 a year at three months' pace: under $400 of net earnings, no
    // self-employment tax, and income tax alone under $100.
    const small = ["2026-11-05"].map((d) => tx(d, -5_000, "STRIPE TRANSFER", "INCOME_CONTRACTOR"));
    expect(run(person([...pay, ...small]))).toBeNull();
  });

  it("is only beside a paycheck, never for a nonresident, nor beside the engine's own card", () => {
    const stripe = ["2026-09-05", "2026-10-05"].map((d) =>
      tx(d, -80_000, "STRIPE TRANSFER", "INCOME_CONTRACTOR"),
    );
    expect(run(person(stripe))).toBeNull();
    expect(run(person([...pay, ...stripe], { tax_residency: "student_visa" }))).toBeNull();
    const engine = person([...pay, ...stripe]);
    engine.extras = {
      householdMembers: 0,
      taxSetAside: {
        year: 2026,
        status: "needed",
        advice: false,
        holdCents: 100_000,
        taxSoFarCents: 0,
        paidSoFarCents: 0,
        keptApartCents: 0,
        withholdingKnown: true,
        unknowns: [],
        confidence: { percent: 60, reason: "x" },
      },
    };
    expect(run(engine)).toBeNull();
    expect(run(person([...pay, ...stripe]))).not.toBeNull();
  });
});
