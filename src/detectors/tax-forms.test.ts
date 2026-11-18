import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { TAX_FORM_DETECTORS, formsDue } from "./tax-forms";
import { runDetectors } from "./index";

// The tax forms on the way (suggest-taxes gap pass).

const shape = async (name: string, today: string, told: Told = {}) => {
  const data = await inputFromStatements(STUDENT_SHAPES[name](), STUDENT_TODAY, told);
  return { ...data, today } satisfies ProfileInput;
};
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, TAX_FORM_DETECTORS)[0] ?? null;

describe("when the forms are due", () => {
  it("is January 31, or the next business day", () => {
    // The IRS's own dates: February 2, 2026 (January 31 a Saturday), February 1, 2027 (a Sunday).
    expect(formsDue(2025)).toBe("2026-02-02");
    expect(formsDue(2026)).toBe("2027-02-01");
    expect(formsDue(2027)).toBe("2028-01-31");
  });
});

describe("the forms on the way", () => {
  it("lists a W-2 for the RA, and the loan, payout and fellowship forms for others", async () => {
    const ra = run(await shape("ra-two-months", "2026-12-10"))!;
    expect(ra.why).toContain("a W-2 from Stanford University by February 1, 2027");
    const gig = run(await shape("gig-two-months", "2026-12-10"))!;
    expect(gig.why).toContain("a Form 1098-E from Nelnet");
    expect(gig.why).toContain("a Form 1099-K only above $20,000 and 200 payments");
    const fellow = run(await shape("fellowship-two-months", "2026-12-10"))!;
    expect(fellow.why).toContain("no W-2 or 1099: Stanford mails a letter in January");
    const visa = run(
      await shape("fellowship-two-months", "2026-12-10", { tax_residency: "student_visa" }),
    )!;
    expect(visa.why).toContain("Form 1042-S from Stanford in March");
    for (const s of [ra, gig, fellow, visa])
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
  });

  it("is shown from December 1 to February 15, for the year just ended", async () => {
    expect(run(await shape("ra-two-months", "2026-11-30"))).toBeNull();
    expect(run(await shape("ra-two-months", "2026-12-01"))).not.toBeNull();
    expect(run(await shape("ra-two-months", "2027-02-15"))!.title).toContain("for 2026");
    expect(run(await shape("ra-two-months", "2027-02-16"))).toBeNull();
  });

  it("says nothing with no payer that sends one", async () => {
    expect(run(await shape("moved-to-stanford", "2026-12-10"))).toBeNull();
  });
});
