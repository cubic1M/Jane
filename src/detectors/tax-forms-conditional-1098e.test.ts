import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { TAX_FORM_DETECTORS } from "./tax-forms";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, PR 2266 (comment 4695930914): a Form 1098-E comes only when the year's
// interest reached the threshold, and a loan payment doesn't say it did, so the lender's line
// isn't counted as a form on the way.

describe("the conditional Form 1098-E", () => {
  it("is named, but not counted as a January form, for a person with only loan payments", async () => {
    const base = await inputFromStatements(STUDENT_SHAPES["gig-two-months"]!(), STUDENT_TODAY, {});
    const data = { ...base, today: "2026-12-10" } satisfies ProfileInput;
    const s = runDetectors({ profile: buildProfile(data), data }, TAX_FORM_DETECTORS)[0]!;
    expect(s.why).toContain("a Form 1098-E from Nelnet");
    expect(s.why).toContain("if the year's interest reached");
    expect(s.title).not.toMatch(/^\d+ tax forms?/);
    expect(s.title).toContain("Tax paperwork for 2026");
    expect(s.why).not.toContain("send these by January 31");
  });
});
