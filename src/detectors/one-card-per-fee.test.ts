import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { BILL_FACT_DETECTORS } from "./cover-facts";
import { runDetectors } from "./index";
import { MONEY_DETECTORS } from "./money";
import { undergrad } from "./__fixtures__/students";

// Debugger 11-18 (r348, Upload S2: Bank of America checking with a $12 monthly fee three times and
// $2,900 of pay deposited, on a phone): the dock had "Stop paying bank fees, save $144 a year" and
// "Ask about your waivable bank fee, save $144 a year", two cards for one $12 fee. The waiver card
// says it with the bank's own rule; the general one steps aside unless there are other fees too.

const row = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "ug-checking",
});
const bofa = (extra: ProfileTx[] = []): ProfileInput => {
  const base = undergrad();
  return {
    ...base,
    accounts: [{ ...base.accounts[0]!, institution: null, name: "Bank of America checking" }],
    transactions: [
      ...base.transactions.filter(
        (t) => t.pfc !== "INCOME_WAGES" && !/SERVICE FEE|FEE/.test(t.description),
      ),
      ...["2026-09-16", "2026-10-16", "2026-11-16"].map((d) =>
        row(d, 1_200, "MONTHLY MAINTENANCE FEE", "BANK_FEES_OTHER_BANK_FEES"),
      ),
      ...["2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map((d) =>
        row(d, -145_000, "ACME CORP DES:PAYROLL", "INCOME_WAGES"),
      ),
      ...extra,
    ],
  };
};
const topics = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...MONEY_DETECTORS,
    ...BILL_FACT_DETECTORS,
  ]).map((s) => s.topic);

describe("a monthly fee the person's pay may waive", () => {
  it("is one card, the waiver's", () => {
    const t = topics(bofa());
    expect(t).toContain("fee_waiver_met");
    expect(t).not.toContain("bank_fees");
  });

  it("still has the bank fees card when there are other fees too", () => {
    const t = topics(
      bofa([row("2026-10-21", 3_500, "OVERDRAFT ITEM FEE", "BANK_FEES_OVERDRAFT_FEES")]),
    );
    expect(t).toContain("fee_waiver_met");
    expect(t).toContain("bank_fees");
  });
});
