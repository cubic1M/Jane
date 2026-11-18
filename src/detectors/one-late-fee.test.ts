import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { MONEY_DETECTORS } from "./money";

// Debugger 11-18 (r346, one $14 Nelnet late fee in four months of Chase checking, on a phone): the
// dock's late fee card said "You paid $14.00 in 1 late fees."

describe("one late fee", () => {
  it("is said as one", () => {
    const base = inputFor("freelancer");
    const data = {
      ...base,
      transactions: [
        ...base.transactions,
        {
          date: "2026-09-04",
          amountCents: 1_400,
          description: "NELNET STUDENT LOAN LATE FEE",
          pfc: "BANK_FEES_LATE_FEES",
          accountId: "x",
        },
      ],
    };
    const s = runDetectors({ profile: buildProfile(data), data }, MONEY_DETECTORS).find(
      (x) => x.topic === "late_fees",
    );
    expect(s?.why).toMatch(/in 1 late fee\. /);
    expect(s?.short).not.toMatch(/1 late fees/);
  });
});
