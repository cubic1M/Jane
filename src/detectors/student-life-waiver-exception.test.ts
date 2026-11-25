import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_LIFE_DETECTORS } from "./student-life";
import { grad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, det-04 finding 12: the Cardinal Care waiver summary names the $10,600 cap as
// the annual out-of-pocket maximum and points to the waiver page's exceptions for employer plans.

describe("the Cardinal Care waiver summary", () => {
  it("names the cap as the out-of-pocket maximum and the employer-plan exceptions", () => {
    const data: ProfileInput = { ...grad(), told: { is_student: true } };
    const s = runDetectors({ profile: buildProfile(data), data }, STUDENT_LIFE_DETECTORS).find(
      (x) => x.topic === "cardinal_care_check",
    )!;
    expect(s.why).toContain("an annual out-of-pocket maximum of $10,600");
    expect(s.why).not.toContain("a deductible and an out-of-pocket maximum");
    expect(s.why).toContain("exceptions to these rules, some for employer plans");
  });
});
