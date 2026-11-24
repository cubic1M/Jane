import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileLiability } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { STUDENT_AID_DETECTORS } from "./student-aid";

// CodeRabbit sweep 1b: a SAVE loan whose payment the bank doesn't report was read as paying $0,
// so the card said Standard would be "that much more than now".
const LOAN: ProfileLiability = {
  accountId: "acc_fed",
  kind: "student",
  aprBps: 553,
  hasPmi: null,
  payoffDate: null,
  description: "Direct Unsubsidized",
  originationDate: "2019-08-20",
  repaymentPlan: "saving on a valuable education",
  loanStatus: "forbearance",
};
const card = (loan: Partial<ProfileLiability>) => {
  const base = inputFor("freelancer");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-06",
    accounts: [
      ...base.accounts.filter((a) => a.subtype !== "student"),
      { id: "acc_fed", subtype: "student", balanceCents: -2_400_000 } as never,
    ],
    liabilities: [...base.liabilities.filter((l) => l.kind !== "student"), { ...LOAN, ...loan }],
  };
  return runDetectors({ profile: buildProfile(data), data }, STUDENT_AID_DETECTORS).find(
    (s) => s.topic === "student_save_ending",
  );
};

describe("SAVE ending with the payment not reported", () => {
  it("still shows the plan choice, without a payment increase", () => {
    const s = card({ minimumCents: null })!;
    expect(s).toBeDefined();
    expect(s.why).not.toMatch(/more than now/);
    expect(s.why).toMatch(/can't compare Standard with your payment now/);
    expect(s.worthCents).toBe(0);
  });
  it("still names the increase when the payment is known", () => {
    expect(card({ minimumCents: 0 })!.why).toMatch(/more than now/);
  });
});
