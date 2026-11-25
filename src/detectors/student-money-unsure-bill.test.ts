import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_MONEY_DETECTORS } from "./student-money";
import { undergrad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, PR 2266 (comments 4695930887 and 4695930894): when the program isn't known
// the bill has two possible dates, so the headline and the short line name both rather than
// asserting the first, and no line pairs one date with the other date's projected balance.

const fire = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS).find(
    (s) => s.topic === "bill_gap_ahead",
  ) ?? null;

const row = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId = "ug-checking",
): ProfileTx => ({ date, amountCents, description, pfc, accountId });

// $500 in cash, a pay deposit of $600 on Nov 11 and a small spend: net money comes in each day, so
// the cash is higher by January 20 than by December 17, and the shortfalls differ by date.
const inflow = (told: ProfileInput["told"]): ProfileInput => {
  const base = undergrad();
  return {
    ...base,
    today: "2026-12-10",
    told: { is_student: true, ...told },
    accounts: [{ ...base.accounts[0]!, balanceCents: 50_000 }],
    transactions: [
      row("2026-10-19", 420_000, "STANFORD UNIV STUDENT ACCT EPAY", "GENERAL_SERVICES_EDUCATION"),
      row("2026-11-10", 1_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
      row("2026-11-11", -60_000, "PAYROLL DEPOSIT", "INCOME_WAGES"),
      row("2026-12-08", 1_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
    ],
  };
};

describe("the Stanford bill when the program isn't known", () => {
  it("names both dates in the headline and the short line", () => {
    const s = fire(inflow({}))!;
    expect(s).not.toBeNull();
    expect(s.short).toContain("Dec 17");
    expect(s.short).toContain("Jan 20");
    // The headline asserts no single date as the deadline.
    expect(s.headline).not.toContain("Dec 17");
  });

  it("never pairs one date with the other date's balance", () => {
    const s = fire(inflow({}))!;
    // $500 + $79.25 in - $2.64 out is $576.61 by December 17; $948.68 is January 20's balance.
    expect(s.why).toContain("by December 17 about $79.25 comes in and $2.64 goes out");
    expect(s.short).not.toMatch(/Dec 17;.*\$948\.68/);
    expect(s.short).toContain("at most");
  });

  it("keeps the single date, with its own balance, for a known program", () => {
    const s = fire(inflow({ enrollment: "undergrad" }))!;
    expect(s.short).toContain("you'll have about $576.61");
    expect(s.headline).toContain("Dec 17");
    expect(s.headline).not.toContain("Jan 20");
    expect(s.short).toContain("Dec 17");
    expect(s.short).not.toContain("Jan 20");
  });
});
