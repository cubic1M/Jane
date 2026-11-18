import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/config/questions";
import { buildProfile, type Told } from "@/profile/build";
import { bestQuestion } from "@/profile/questions";
import {
  STUDENT_SHAPES,
  STUDENT_TODAY,
  inputFromStatements,
  suggestionsOf,
} from "./__fixtures__/student-walk";

// The manager's bar for the questions (suggest-taxes phase 2): a thin-data student who answers the
// questions Jane asks, one at a time, the best first, sees tax cards appear that weren't there. Each
// answer is the one a typical Stanford student of that shape would give.

const ANSWERS: Record<string, Record<string, string>> = {
  "undergrad-one-month": {
    claimed_as_dependent: "yes",
    enrollment: "undergrad",
    age_25_plus: "no",
  },
  "fellowship-one-month": { school_deposit: "fellowship", tax_residency: "student_visa" },
  "gig-two-months": {
    enrollment: "grad",
    age_25_plus: "yes",
    claimed_as_dependent: "no",
    filing_status: "single",
  },
};

async function answerUpTo(shape: string, most: number) {
  const files = STUDENT_SHAPES[shape]();
  let told: Told = {};
  const asked: string[] = [];
  for (let i = 0; i < most; i += 1) {
    const data = await inputFromStatements(files, STUDENT_TODAY, told);
    const next = bestQuestion(buildProfile(data), data, new Set(asked));
    if (!next) break;
    asked.push(next.spec.fact);
    const answer = ANSWERS[shape][next.spec.fact] ?? "unsure";
    expect(QUESTIONS.find((q) => q.fact === next.spec.fact)!.choices.map((c) => c.value)).toContain(
      answer,
    );
    told = { ...told, [next.spec.fact]: answer };
  }
  const before = suggestionsOf(await inputFromStatements(files, STUDENT_TODAY)).map((s) => s.topic);
  const after = suggestionsOf(await inputFromStatements(files, STUDENT_TODAY, told)).map(
    (s) => s.topic,
  );
  return { asked, before, after, appeared: after.filter((t) => !before.includes(t)) };
}

describe("answering Jane's questions", () => {
  it("shows an undergraduate the education credit their parent can take", async () => {
    const r = await answerUpTo("undergrad-one-month", 3);
    expect(r.asked[0]).toBe("claimed_as_dependent");
    expect(r.appeared).toContain("education_credit");
  });

  it("shows a fellow on a student visa what nonresidents file, and drops the US fellowship card", async () => {
    const r = await answerUpTo("fellowship-one-month", 3);
    expect(r.appeared).toContain("student_tax_residency");
    expect(r.after).not.toContain("stipend_tax");
  });

  it("drops the Saver's cards for a graduate gig student, and shows the earned income credit on the fourth answer", async () => {
    // Enrollment, filing status and dependency rank above age for this person.
    const r = await answerUpTo("gig-two-months", 4);
    expect(r.asked).toEqual(expect.arrayContaining(["enrollment", "age_25_plus"]));
    expect(r.appeared).toContain("earned_income_credit");
    expect(r.after).not.toContain("savers_credit");
  });
});
