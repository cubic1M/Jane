import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { QUESTIONS } from "@/config/questions";
import { decidesLine } from "@/lib/questions";
import { bestQuestion } from "@/profile/questions";
import {
  RESIDENCY_NOTE,
  RESIDENT_ONLY_TOPICS,
  OPEN_TO_NONRESIDENTS,
  earnedIncomeHeldLine,
  residentOnlyAllowed,
  residentOnlyAllowedFor,
} from "@/planning/tax-engine/residency-gate";
import { f1 } from "./__fixtures__/students";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// The residency gate (tax program T10): a credit that is for residents only (the education credits
// and the earned income credit: IRS Publication 519, chapter 5, nonresident aliens' credits) is
// shown only to someone who told Jane they are a citizen or green card holder.

const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...STUDENT_CREDIT_DETECTORS,
    ...SAVERS_CREDIT_DETECTORS,
  ]).map((s) => s.topic);

// Low pay gives the earned income credit something to figure (no tax is owed); with more pay there
// is tax for the education credit and the student loan interest to come off, and the saver's credit.
const LOW_PAY = 40_000;
const HIGH_PAY = 100_000;
const answers = (tax_residency?: string) => ({
  ...(tax_residency === undefined ? {} : { tax_residency }),
});

describe("residentOnlyAllowed", () => {
  it("is true only for a told citizen or green card holder", () => {
    expect(residentOnlyAllowed({ tax_residency: { value: "citizen" } })).toBe(true);
    for (const value of ["student_visa", "other_visa", "unsure", null, undefined, "", "Citizen"])
      expect(residentOnlyAllowed({ tax_residency: { value } }), String(value)).toBe(false);
    expect(residentOnlyAllowed({})).toBe(false);
    expect(residentOnlyAllowedFor("citizen")).toBe(true);
    expect(residentOnlyAllowedFor(undefined)).toBe(false);
  });

  it("names Publication 519 for every topic it holds or leaves open", () => {
    for (const t of [
      ...Object.values(RESIDENT_ONLY_TOPICS),
      ...Object.values(OPEN_TO_NONRESIDENTS),
    ])
      expect(t.where).toMatch(/^Chapter 5/);
  });
});

describe("the resident-only cards", () => {
  it.each([
    ["not asked yet", undefined],
    ["not sure", "unsure"],
    ["an F or J student visa", "student_visa"],
    ["another visa", "other_visa"],
  ])("show no education credit and no earned income credit to someone with %s", (_, said) => {
    expect(run(f1(answers(said), LOW_PAY))).not.toContain("earned_income_credit");
    expect(run(f1(answers(said), HIGH_PAY))).not.toContain("education_credit");
  });

  it("show both to a citizen or green card holder, and the answer brings them back at once", () => {
    expect(run(f1(answers(undefined), HIGH_PAY))).not.toContain("education_credit");
    expect(run(f1(answers("citizen"), HIGH_PAY))).toContain("education_credit");
    expect(run(f1(answers(undefined), LOW_PAY))).not.toContain("earned_income_credit");
    expect(run(f1(answers("citizen"), LOW_PAY))).toContain("earned_income_credit");
  });

  it("say on the education card why it needs the answer (fact wording, Pub. 519)", () => {
    const data = f1(answers("citizen"), HIGH_PAY);
    const card = runDetectors({ profile: buildProfile(data), data }, STUDENT_CREDIT_DETECTORS).find(
      (s) => s.topic === "education_credit",
    )!;
    expect(card.why).toContain(RESIDENCY_NOTE);
  });

  it("keep the student loan interest card unless a student visa is told (Pub. 519 leaves the deduction open; a nonresident has no standard deduction, so that figure waits for T15)", () => {
    for (const said of [undefined, "unsure", "other_visa", "citizen"])
      expect(run(f1(answers(said), HIGH_PAY)), String(said)).toContain("student_loan_interest");
    expect(run(f1(answers("student_visa"), HIGH_PAY))).not.toContain("student_loan_interest");
  });

  it("do not tie California's renter's credit to a visa (the FTB's conditions name none)", () => {
    for (const said of [undefined, "student_visa", "other_visa", "citizen"])
      expect(run(f1(answers(said), LOW_PAY)), String(said)).toContain("ca_renters_credit");
  });

  it("leave the saver's credit alone: it does not read a visa", () => {
    // Not a full-time student: the saver's credit is not for them.
    for (const said of [undefined, "student_visa", "other_visa", "citizen"])
      expect(
        run(f1({ ...answers(said), enrollment: "not_enrolled" }, HIGH_PAY)),
        String(said),
      ).toContain("savers_credit");
  });
});

describe("the question that settles it", () => {
  it("is asked first when a resident-only card is held back, and says what it decides", () => {
    const data = f1(answers(undefined), HIGH_PAY);
    const best = bestQuestion(buildProfile(data), data, new Set())!;
    expect(best.spec.fact).toBe("tax_residency");
    expect(best.decidesCount).toBeGreaterThanOrEqual(1);
    expect(decidesLine(best.spec, best.decidesCount)).toMatch(
      /^It decides (a credit or form|\d+ credits and forms) for you\.$/,
    );
  });

  it("is asked first for the earned income credit too", () => {
    const data = f1(answers(undefined), LOW_PAY);
    expect(bestQuestion(buildProfile(data), data, new Set())!.spec.fact).toBe("tax_residency");
  });

  it("is not asked of someone who already said", () => {
    const data = f1(answers("citizen"), HIGH_PAY);
    expect(bestQuestion(buildProfile(data), data, new Set())?.spec.fact).not.toBe("tax_residency");
  });

  it("offers a citizen or green card holder the first answer", () => {
    const q = QUESTIONS.find((x) => x.fact === "tax_residency")!;
    expect(q.choices[0]).toEqual({ label: "Citizen or green card", value: "citizen" });
  });
});

describe("the estimate without the earned income credit", () => {
  it("says in fact words why, and asks only when the status is not known", () => {
    expect(earnedIncomeHeldLine("unknown", 150_000)).toContain("Tell me and I'll check it.");
    expect(earnedIncomeHeldLine("unknown", 150_000)).toContain("$1,500.00");
    expect(earnedIncomeHeldLine("student_visa", 150_000)).toContain("IRS Publication 519");
    expect(earnedIncomeHeldLine("student_visa", 150_000)).not.toContain("Tell me");
    expect(RESIDENCY_NOTE).toContain("first five calendar years");
  });
});
