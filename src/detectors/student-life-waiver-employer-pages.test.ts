import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_LIFE_DETECTORS } from "./student-life";
import { grad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, PR 2266 (comment 4695930877): the waiver page lists the cap, not the
// employer-plan exceptions, which Vaden's coverage-comparison page states, so the sentence names
// both pages. The Vaden page's address isn't in the product's config: it has to be read at
// source before it is added as a link beside the waiver page.

describe("the Cardinal Care card's employer-plan sentence", () => {
  it("names both Stanford pages rather than sending the check to the waiver page alone", () => {
    const data: ProfileInput = { ...grad(), told: { is_student: true } };
    const s = runDetectors({ profile: buildProfile(data), data }, STUDENT_LIFE_DETECTORS).find(
      (x) => x.topic === "cardinal_care_check",
    )!;
    expect(s.why).toContain("Vaden Health Center's coverage-comparison page");
    expect(s.why).toContain("waiver page");
    expect(s.why).toContain("some for employer plans");
    expect(s.why).not.toMatch(/waiver page lists exceptions/);
    // The waiver link stays for making a request.
    expect(s.action?.href).toBe("https://stanford.myahpcare.com/waiver");
  });
});
