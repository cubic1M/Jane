import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileLiability } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { STUDENT_AID_DETECTORS } from "./student-aid";

// CodeRabbit sweep 1b (#2258): one SAVE loan with a known $0 payment and a second whose payment
// isn't reported: the second could cancel the first's rise, so no yearly figure is shown.
const loan = (id: string, minimumCents: number | null): ProfileLiability => ({
  accountId: id,
  kind: "student",
  aprBps: 553,
  hasPmi: null,
  payoffDate: null,
  description: "Direct Unsubsidized",
  originationDate: "2019-08-20",
  repaymentPlan: "saving on a valuable education",
  loanStatus: "forbearance",
  minimumCents,
});
const card = (second: number | null) => {
  const base = inputFor("freelancer");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-06",
    accounts: [
      ...base.accounts.filter((a) => a.subtype !== "student"),
      { id: "acc_a", subtype: "student", balanceCents: -1_200_000 } as never,
      { id: "acc_b", subtype: "student", balanceCents: -1_200_000 } as never,
    ],
    liabilities: [
      ...base.liabilities.filter((l) => l.kind !== "student"),
      loan("acc_a", 0),
      loan("acc_b", second),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, STUDENT_AID_DETECTORS).find(
    (s) => s.topic === "student_save_ending",
  );
};

describe("SAVE ending with one payment known and one not", () => {
  it("shows no yearly figure", () => {
    const s = card(null)!;
    expect(s).toBeDefined();
    expect(s.worthCents).toBe(0);
  });
  it("keeps the yearly figure when both are known", () => {
    expect(card(0)!.worthCents).toBeGreaterThan(0);
  });
});
