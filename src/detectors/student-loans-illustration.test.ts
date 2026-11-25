import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileLiability } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_LOANS_HELD_DETECTORS } from "./student-loans-held";
import { undergrad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, det-04 finding 6: the ten-year figure is an illustration, never "the
// Standard plan's" payment (the loans' types and disbursement dates aren't known).

const LOAN: ProfileLiability = {
  accountId: "fed-1",
  kind: "student",
  aprBps: 653,
  hasPmi: null,
  payoffDate: null,
  description: "Direct Unsubsidized",
  loanStatus: "in grace",
  loanStatusEndDate: "2027-01-31",
};

describe("the ten-year payment on a grace-ending card", () => {
  it("is called an illustration, with the servicer's page for the plan that applies", () => {
    const base = undergrad();
    const data: ProfileInput = {
      ...base,
      today: "2026-11-18",
      accounts: [
        ...base.accounts,
        { id: "fed-1", type: "loan", subtype: "student", balanceCents: -1_800_000 },
      ],
      liabilities: [LOAN],
    };
    const s = runDetectors({ profile: buildProfile(data), data }, STUDENT_LOANS_HELD_DETECTORS)[0]!;
    expect(s.why).not.toContain("Standard plan");
    expect(s.short).not.toContain("Standard");
    expect(s.why).toContain("As an illustration, ten years of level payments");
    expect(s.why).toContain("disbursed");
    expect(s.why).toContain("your servicer sends the first due date");
  });
});
