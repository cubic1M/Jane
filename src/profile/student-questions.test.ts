import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/config/questions";
import {
  STUDENT_SHAPES,
  STUDENT_TODAY,
  inputFromStatements,
} from "@/detectors/__fixtures__/student-walk";
import { decidesLine } from "@/lib/questions";
import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { buildProfile } from "./build";
import { stateOfPayments } from "./home-state";
import { bestQuestion, decidedBy, missingFacts } from "./questions";

// The questions that unlock students' tax findings (suggest-taxes, 11-18): asked one at a time, the
// one that decides the most dollars first, said with what it decides; never for someone it decides
// nothing for.

const spec = (fact: string) => QUESTIONS.find((q) => q.fact === fact)!;

describe("what an answer decides", () => {
  it("asks a one-month fellow what the school's money is, and says what it decides", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["fellowship-one-month"](), STUDENT_TODAY);
    const profile = buildProfile(data);
    const best = bestQuestion(profile, data, new Set())!;
    expect(best.spec.fact).toBe("school_deposit");
    expect(best.decidesCount).toBe(1);
    const card = decidedBy("school_deposit", spec("school_deposit"), data);
    expect(best.unlockCents).toBe(card.cents);
    const line = decidesLine(best.spec, best.decidesCount, best.unlockCents)!;
    expect(line).toMatch(/^It decides a tax figure worth up to \$[\d,]+ for you\.$/);
    expect(
      checkGuardrails(
        `${best.spec.text} ${line}`,
        dollarFigures(line).map((f) => f.cents),
      ),
    ).toEqual({
      ok: true,
    });
  });

  it("asks it once: answered, it's gone, and 'Not sure' counts as answered", async () => {
    for (const answer of ["fellowship", "unsure"]) {
      const data = await inputFromStatements(
        STUDENT_SHAPES["fellowship-one-month"](),
        STUDENT_TODAY,
        {
          school_deposit: answer,
        },
      );
      const facts = missingFacts(buildProfile(data), data).map((c) => c.spec.fact);
      expect(facts).not.toContain("school_deposit");
    }
  });

  it("asks a student with no school money none of the students' tax questions", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["ra-two-months"](), STUDENT_TODAY);
    const facts = missingFacts(buildProfile(data), data).map((c) => c.spec.fact);
    for (const fact of ["school_deposit", "owed_tax_last_year", "tax_residency"])
      expect(facts).not.toContain(fact);
  });

  it("counts several suggestions and names them in the plural", () => {
    expect(decidesLine(spec("claimed_as_dependent"), 3, 286_000)).toBe(
      "It decides 3 credits and deductions worth up to $2,860 for you.",
    );
    expect(decidesLine(spec("claimed_as_dependent"), 1, 286_000)).toBe(
      "It decides a credit or deduction worth up to $2,860 for you.",
    );
    expect(decidesLine(spec("claimed_as_dependent"), 0, 286_000)).toBeUndefined();
    expect(decidesLine(spec("employer_match"), 2, 286_000)).toBeUndefined();
  });

  it("offers one tap per answer, at most four, never a form", () => {
    for (const fact of [
      "school_deposit",
      "claimed_as_dependent",
      "tax_residency",
      "owed_tax_last_year",
    ]) {
      const q = spec(fact);
      expect(q.choices.length).toBeLessThanOrEqual(4);
      expect(q.choices.map((c) => c.label)).toContain("Not sure");
    }
  });
});

describe("the state someone lives in, from where they pay", () => {
  const paid = (description: string) => ({ amountCents: 1_000, description });

  it("reads the state most located purchases are in, from three", () => {
    const three = ["SAFEWAY MOUNTAIN VIEW CA", "NETFLIX.COM CA 10/14", "CHEVRON PALO ALTO CA"].map(
      paid,
    );
    expect(stateOfPayments(three)).toEqual({ code: "CA", matches: 3 });
    expect(stateOfPayments(three.slice(0, 2))).toBeNull();
  });

  it("needs one state to lead with 60% of them: a trip doesn't move anyone", () => {
    const ca = Array.from({ length: 3 }, () => paid("SAFEWAY MOUNTAIN VIEW CA"));
    expect(stateOfPayments([...ca, paid("HOTEL NEW YORK NY"), paid("CAFE NEW YORK NY")])).toEqual({
      code: "CA",
      matches: 3,
    });
    expect(
      stateOfPayments([...ca, ...Array.from({ length: 3 }, () => paid("CAFE NEW YORK NY"))]),
    ).toBeNull();
  });

  it("ignores deposits and two letters that aren't a state", () => {
    expect(
      stateOfPayments([
        { amountCents: -1_000, description: "PAYROLL CA" },
        { amountCents: -1_000, description: "PAYROLL CA" },
        { amountCents: -1_000, description: "PAYROLL CA" },
        paid("SPOTIFY USA XX"),
        paid("SPOTIFY USA XX"),
        paid("SPOTIFY USA XX"),
      ]),
    ).toBeNull();
  });

  it("is told first, then the tax profile's, then seen", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["fellowship-one-month"](), STUDENT_TODAY);
    expect(buildProfile(data).facts.home_state).toMatchObject({ value: "CA", source: "seen" });
    expect(buildProfile({ ...data, state: "NY" }).facts.home_state).toMatchObject({ value: "NY" });
    expect(
      buildProfile({ ...data, state: "NY", told: { home_state: "WA" } }).facts.home_state,
    ).toMatchObject({ value: "WA", source: "told" });
  });
});

describe("the student question and the enrollment one agree", () => {
  it("reads an enrollment answer as the answer to whether they're a student", async () => {
    const shape = STUDENT_SHAPES["gig-two-months"]();
    for (const [enrollment, student] of [
      ["undergrad", true],
      ["grad", true],
      ["not_enrolled", false],
    ] as const) {
      const data = await inputFromStatements(shape, STUDENT_TODAY, { enrollment });
      expect(buildProfile(data).facts.is_student).toMatchObject({ value: student, source: "told" });
    }
  });

  it("doesn't ask how someone is enrolled once they said they aren't a student", async () => {
    const shape = STUDENT_SHAPES["gig-two-months"]();
    const asked = async (told: Record<string, unknown>) => {
      const data = await inputFromStatements(shape, STUDENT_TODAY, told as never);
      return missingFacts(buildProfile(data), data).map((c) => c.spec.fact);
    };
    expect(await asked({})).toContain("enrollment");
    expect(await asked({ is_student: false })).not.toContain("enrollment");
  });
});
