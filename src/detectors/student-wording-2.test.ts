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
    expect(s.headline).toMatch(/^Note: about \$[\d,]+ may be over-withheld$/);
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

describe("two paychecks", () => {
  it("says withholding can fall short, since Jane can't see whether a W-4 allows for the other", () => {
    const tx = (date: string, cents: number, name: string) => ({
      date,
      amountCents: -cents,
      description: `${name} PAYROLL`,
      pfc: "INCOME_SALARY",
      accountId: "a",
    });
    const days = [
      "2026-09-04",
      "2026-09-18",
      "2026-10-02",
      "2026-10-16",
      "2026-10-30",
      "2026-11-13",
    ];
    const data: ProfileInput = {
      today: STUDENT_TODAY,
      transactions: [
        ...days.map((d) => tx(d, 90_000, "ACME CORP")),
        ...days.map((d) => tx(d, 70_000, "BLUE BOTTLE")),
      ],
      accounts: [],
      liabilities: [],
      told: {},
    };
    const s = runDetectors({ profile: buildProfile(data), data }).find(
      (x) => x.topic === "withholding_two_jobs",
    )!;
    expect(s.title).toMatch(/^Withholding on two paychecks can fall about \$/);
    expect(s.short).toMatch(/^Unless a W-4 allows for the other/);
    expect(s.short.length).toBeLessThanOrEqual(120);
    passes(s.title);
    passes(s.short);
  });
});
