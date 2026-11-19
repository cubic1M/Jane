import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2, desktop sweep 7, upload S6 (11-19: 14 months of Wells Fargo checking, UC pay every two
// weeks, $400 a month by Zelle from a family member, rent in California): Taxes said "income near
// $27,444.46" on the Saver's Credit and "income near $18,744.80" on California's renter's credit.
// One person's income for a return is one figure; a family member's transfers aren't part of it.

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tx = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});
const months = Array.from({ length: 15 }, (_, i) =>
  new Date(Date.UTC(2025, 8 + i, 1)).toISOString().slice(0, 7),
).filter((m) => m <= "2026-11");
const data: ProfileInput = {
  today: "2026-11-19",
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 141_222 }],
  liabilities: [],
  told: { home_state: "CA" },
  transactions: [
    ...Array.from({ length: 31 }, (_, i) => addDays("2025-09-26", i * 14))
      .filter((d) => d <= "2026-11-14")
      .map((d) => tx(d, -62_500, "UNIV OF CALIF PAYROLL PPD", "INCOME_SALARY")),
    ...months.map((m) => tx(`${m}-03`, -40_000, "ZELLE FROM LI MEI", "INCOME_OTHER_INCOME")),
    ...months.map((m) => tx(`${m}-01`, 95_000, "BRIDGE APTS RENT ACH", "RENT_AND_UTILITIES_RENT")),
  ],
};

const incomeNear = (topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...STUDENT_CREDIT_DETECTORS,
    ...SAVERS_CREDIT_DETECTORS,
  ])
    .find((s) => s.topic === topic)
    ?.why.match(/income near (\$[\d,]+\.\d{2})/)?.[1];

describe("income near, with money from family", () => {
  it("is one figure on the Saver's Credit and California's renter's credit", () => {
    const savers = incomeNear("savers_credit");
    expect(savers).toMatch(/^\$\d/);
    expect(incomeNear("ca_renters_credit")).toBe(savers);
  });
});
