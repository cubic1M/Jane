import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runDetectors } from "@/detectors";
import { MONEY_DETECTORS } from "@/detectors/money";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { bankFees } from "./rules/bank-fees";
import { cardInterest } from "./rules/card-interest";
import type { DetectionInput } from "./types";

// Debug 3, 11-16 (gate C): a charge is paced over the months its own account's data covers, not
// the person's. Nia's checking file runs Aug 1 to Oct 14 with a $12 monthly fee on Aug 15 and Sep
// 15, beside a card statement from Jun 1 to Nov 8: the fees were paced over Jun 1 to Nov 15, "the
// last 5 months", $57.60 a year (with the card from Aug 10, "3 months", $96), where a monthly $12
// fee is $144. And a card's interest beside a longer checking file was spread over the checking's
// months.

const TODAY = "2026-11-16";
const day = (from: string, n: number) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Line = { date: string; accountId: string; cents: number; pfc: string; description: string };
// Coffee every third day from `from` to `to`.
const everyday = (accountId: string, from: string, to: string): Line[] => {
  const out: Line[] = [];
  for (let d = from; d <= to; d = day(d, 3)) {
    out.push({
      date: d,
      accountId,
      cents: 500,
      pfc: "FOOD_AND_DRINK_COFFEE",
      description: "COFFEE",
    });
  }
  return out;
};
const fee = (date: string): Line => ({
  date,
  accountId: "checking",
  cents: 1_200,
  pfc: "BANK_FEES_OTHER_BANK_FEES",
  description: "MONTHLY SERVICE FEE",
});
const interest = (date: string): Line => ({
  date,
  accountId: "card",
  cents: 2_500,
  pfc: "BANK_FEES_INTEREST_CHARGE",
  description: "INTEREST CHARGE ON PURCHASES",
});
const ACCOUNTS = [
  { id: "checking", name: "Chase checking", type: "depository", subtype: "checking" },
  { id: "card", name: "Chase card", type: "credit", subtype: "credit card" },
];

// Both statements uploaded today.
function report(lines: Line[]): DetectionInput {
  return {
    asOf: TODAY,
    accounts: ACCOUNTS.map((a) => ({ ...a, currentBalanceCents: 0 })),
    transactions: lines.map((l, i) => ({
      id: `t${i}`,
      date: l.date,
      accountId: l.accountId,
      amountCents: l.cents,
      description: l.description,
      merchant: l.description,
      merchantKey: l.description.toLowerCase(),
      pfcPrimary: l.pfc.startsWith("BANK_FEES") ? "BANK_FEES" : "FOOD_AND_DRINK",
      pfcDetailed: l.pfc,
      categorySource: "rule",
      pending: false,
      uploadedOn: TODAY,
    })),
  } as unknown as DetectionInput;
}
function dock(lines: Line[]) {
  const data: ProfileInput = {
    ...inputFor("renter"),
    today: TODAY,
    accounts: ACCOUNTS.map((a) => ({ ...a, balanceCents: 0 })),
    liabilities: [],
    transactions: lines.map((l) => ({
      date: l.date,
      accountId: l.accountId,
      amountCents: l.cents,
      description: l.description,
      pfc: l.pfc,
      uploadedOn: TODAY,
    })),
  };
  return runDetectors({ profile: buildProfile(data), data }, MONEY_DETECTORS);
}

describe("a charge paced over its own account's months", () => {
  const checking = [
    ...everyday("checking", "2026-08-01", "2026-10-14"),
    fee("2026-08-15"),
    fee("2026-09-15"),
  ];

  it.each(["2026-06-01", "2026-08-10"])("is a monthly fee's year beside a card from %s", (from) => {
    const lines = [...checking, ...everyday("card", from, "2026-11-08")];
    const [found] = bankFees(report(lines), []);
    expect(found?.title).toBe("$24.00 in fees on Chase checking in the last 2 months");
    expect(found?.annualSavingsCents).toBe(14_400);
    expect(dock(lines).find((s) => s.topic === "bank_fees")?.worthCents).toBe(14_400);
  });

  it("is the same with the checking file alone", () => {
    expect(bankFees(report(checking), [])[0]?.annualSavingsCents).toBe(14_400);
  });

  it("counts its history from its first line ever, before the lines read", () => {
    // The same file with a line from a year before: a year of history, so the fees as seen.
    const input = { ...report(checking), accountsFrom: { checking: "2025-09-01" } };
    expect(bankFees(input, [])[0]?.annualSavingsCents).toBe(2_400);
  });

  it("paces a card's interest over the card's months, beside a longer checking file", () => {
    const lines = [
      ...everyday("checking", "2026-01-05", "2026-11-10"),
      ...everyday("card", "2026-08-01", "2026-11-08"),
      ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map(interest),
    ];
    // $100 in the card's 3 months: $400 a year.
    const [found] = cardInterest(report(lines), []);
    expect(found?.title).toBe("$100.00 in interest on Chase card in the last 3 months");
    expect(found?.annualSavingsCents).toBe(40_000);
    expect(dock(lines).find((s) => s.topic === "card_interest")?.worthCents).toBe(40_000);
  });
});
