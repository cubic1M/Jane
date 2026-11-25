import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { TAX_FORM_DETECTORS } from "./tax-forms";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, det-04 finding 14: only forms are counted, each with its own date.

const shape = async (name: string, today: string, told: Told = {}) => {
  const data = await inputFromStatements(STUDENT_SHAPES[name](), STUDENT_TODAY, told);
  return { ...data, today } satisfies ProfileInput;
};
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, TAX_FORM_DETECTORS)[0] ?? null;

describe("counting the forms", () => {
  it("dates a lone Stanford 1042-S in March, not by the January deadline", async () => {
    const s = run(
      await shape("fellowship-two-months", "2026-12-10", { tax_residency: "student_visa" }),
    )!;
    expect(s.title).toContain("1 tax form for 2026 should reach you in March");
    expect(s.title).not.toContain("February 1");
    expect(s.why).not.toContain("by January 31");
  });

  it("does not count a resident fellowship's 'no W-2 or 1099' note as a form", async () => {
    const s = run(await shape("fellowship-two-months", "2026-12-10"))!;
    expect(s.title).not.toMatch(/^\d+ tax forms?/);
    expect(s.title).toContain("Tax paperwork for 2026");
    expect(s.why).toContain("no W-2 or 1099");
  });
});
