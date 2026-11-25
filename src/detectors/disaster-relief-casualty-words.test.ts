import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SAMPLE_RELIEF } from "@/config/disasters";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 17): the card describes the rules the calculator applied. A qualified
// disaster has a $500 floor, no income floor and no need to itemize; any other has the $100 and
// 10%-of-income floors and counts when itemizing.
const card = (relief: Partial<(typeof SAMPLE_RELIEF)[number]>, repairsCents = 2_000_000) => {
  const base = inputFor("family");
  const data: ProfileInput = {
    ...base,
    state: "TX",
    extras: { ...base.extras!, disasterRelief: [{ ...SAMPLE_RELIEF[0], ...relief }] },
    transactions: [
      ...base.transactions,
      {
        date: "2026-09-20",
        amountCents: repairsCents,
        description: "ROOF REPAIR CONTRACTOR",
        pfc: "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
        accountId: base.accounts[0]!.id,
      },
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "disaster_relief",
  )!;
};

describe("the casualty loss rules the disaster card names", () => {
  it("names the $100 and 10% floors, and itemizing, for an ordinary declared disaster", () => {
    const s = card({ qualified: false });
    expect(s.why).toContain("$100.00 and 10%-of-income");
    expect(s.why).toContain("if you itemize");
  });

  it("names the $500 floor with no income floor and no itemizing for a qualified disaster", () => {
    const s = card({ qualified: true });
    expect(s.why).toContain("qualified disaster");
    expect(s.why).toContain("$500.00");
    expect(s.why).toContain("no need to itemize");
    expect(s.why).not.toContain("10%-of-income");
    expect(s.why).not.toContain("if you itemize");
  });

  it("says a disaster that isn't federally declared gives no deductible loss", () => {
    const s = card({ federallyDeclared: false });
    expect(s.why).toContain("isn't federally declared");
  });
});
