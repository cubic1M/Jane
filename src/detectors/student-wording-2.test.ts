import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { HEADLINE_MAX, HEADLINE_MAX_WORDS, cardHeadline } from "./contract";
import { runDetectors, type Suggestion } from "./index";

// The chat tests lane's second wording read (11-18): where a condition Jane can't see decides it, the
// card says "can" and whose rules decide; the part-year card states the method, not an ask.

const card = async (shape: string, topic: string, today = STUDENT_TODAY): Promise<Suggestion> => {
  const data: ProfileInput = {
    ...(await inputFromStatements(STUDENT_SHAPES[shape](), STUDENT_TODAY)),
    today,
  };
  return runDetectors({ profile: buildProfile(data), data }).find((s) => s.topic === topic)!;
};
const passes = (text: string) => {
  expect(
    checkGuardrails(
      text,
      dollarFigures(text).map((f) => f.cents),
    ),
    text,
  ).toEqual({ ok: true });
  expect(tellsThemToAct(text), text).toBe(false);
  expect(recommendsAChoice(text), text).toBe(false);
};

describe("the second wording read", () => {
  it("states the part-year method as the IRS's, with asking for it the person's to decide", async () => {
    const s = await card("ra-two-months", "withholding_part_year");
    expect(s.headline).toMatch(/^Note: about \$[\d,]+ withheld beyond the year's tax$/);
    expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(cardHeadline(s.headline).split(/\s+/).length).toBeLessThanOrEqual(HEADLINE_MAX_WORDS);
    passes(s.headline);
    const method = s.why
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .find((x) => x.includes("part-year method"))!;
    expect(method).toContain("IRS Pub. 15-T has a part-year method");
    passes(method);
    expect(s.why).toContain("Asking for it is yours to decide.");
    expect(s.more?.[0].href).toBe("https://www.irs.gov/publications/p15t");
  });

  it("says California's renter's credit can be $60, and that FTB's rules decide it", async () => {
    const s = await card("gig-two-months", "ca_renters_credit");
    expect(s.title).toBe(
      "California's renter's credit can be $60 at your income; FTB's rules decide it",
    );
    expect(s.short).toMatch(/: the credit can be \$60; FTB's rules decide it\.$/);
    passes(s.title);
    passes(s.short);
  });

  it("says student loan interest can come off income, with the IRS's publication", async () => {
    const s = await card("gig-two-months", "student_loan_interest");
    expect(s.title).toBe("Student loan interest can come off income, up to $2,500 (IRS Pub. 970)");
    passes(s.title);
  });
});
