import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHASE_OVERDRAFT, OVERDRAFT_OPT_IN } from "@/config/student-money";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { DETECTORS, runDetectors } from "./index";
import { undergrad } from "./__fixtures__/students";

// Walk batch 3's upload S5 (phone, 11-20): a $34 insufficient funds fee at Chase "FOR A $16.40
// ITEM", and the bank-fees card told them Chase's rule that there's no overdraft fee when
// overdrawn by $50 or less, which Claude then repeated. That rule, and the CFPB's opt-in rule, are
// about overdraft fees: the card cites a rule only beside a fee it covers.

const bankFees = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).find(
    (s) => s.topic === "bank_fees",
  ) ?? null;

// The undergraduate at Chase, with the overdraft fee made an insufficient-funds fee.
function nsfAtChase(): ProfileInput {
  const base = undergrad();
  return {
    ...base,
    transactions: base.transactions.map((t) =>
      t.pfc === "BANK_FEES_OVERDRAFT_FEES"
        ? {
            ...t,
            description: "INSUFFICIENT FUNDS FEE FOR A $16.40 ITEM - DETAILS: SAFEWAY",
            pfc: "BANK_FEES_INSUFFICIENT_FUNDS",
          }
        : t,
    ),
  };
}

describe("the rules the bank-fees card cites", () => {
  it("names only overdraft fees as what each covers", () => {
    expect(CHASE_OVERDRAFT.covers).toEqual(["BANK_FEES_OVERDRAFT_FEES"]);
    expect(OVERDRAFT_OPT_IN.covers).toEqual(["BANK_FEES_OVERDRAFT_FEES"]);
  });

  it("cites neither beside an insufficient-funds fee, and still makes the card", () => {
    const s = bankFees(nsfAtChase());
    expect(s).not.toBeNull();
    expect(s!.why).not.toContain("Chase's own rule");
    expect(s!.why).not.toContain("overdrawn by $50 or less");
    expect(s!.why).not.toContain("opt-in");
    expect(s!.more).toBeUndefined();
  });

  it("still cites both beside an overdraft fee at Chase", () => {
    const s = bankFees(undergrad())!;
    expect(s.why).toContain("Chase's own rule");
    expect(s.why).toContain("need your opt-in");
    expect(s.more?.map((m) => m.href)).toContain(CHASE_OVERDRAFT.url);
  });
});
