import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";
import { UTILITY_DETECTORS } from "./utilities";
import { runDetectors } from "./index";

// Debug 2, desktop sweep 8 (11-19, the 14-month Plaid person: UC pay every two weeks and $400 a
// month by Zelle from a family member): Spending's Lifeline card said "Income near $21,204.46" and
// Taxes' Saver's Credit "Income near $21,530.03". One person's year of income is one figure on every
// income-tested card.

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
  told: { household: "single" },
  transactions: [
    ...Array.from({ length: 31 }, (_, i) => addDays("2025-09-26", i * 14))
      .filter((d) => d <= "2026-11-14")
      .map((d) => tx(d, -60_000, "UNIV OF CALIF PAYROLL PPD", "INCOME_SALARY")),
    ...months.map((m) => tx(`${m}-03`, -40_000, "ZELLE FROM LI MEI", "INCOME_OTHER_INCOME")),
    ...months.map((m) => tx(`${m}-08`, 6_500, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE")),
  ],
};

const incomeNear = (topic: string) => {
  const s = runDetectors({ profile: buildProfile(data), data }, [
    ...UTILITY_DETECTORS,
    ...SAVERS_CREDIT_DETECTORS,
  ]).find((x) => x.topic === topic);
  return `${s?.short} ${s?.why}`
    .match(/[Ii]ncome near (\$[\d,]+\.\d{2})|near (\$[\d,]+\.\d{2})/)
    ?.slice(1)
    .find(Boolean);
};

describe("income near, on Spending and Taxes", () => {
  it("is one figure on Lifeline and the Saver's Credit", () => {
    const savers = incomeNear("savers_credit");
    expect(savers).toMatch(/^\$\d/);
    expect(incomeNear("lifeline")).toBe(savers);
  });
});
