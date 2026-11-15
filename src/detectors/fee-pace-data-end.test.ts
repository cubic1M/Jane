import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { detect } from "@/detection/detect";
import type { DetectionInput } from "@/detection/types";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

// Debugger 11-14: an uploaded statement's fees, read weeks after it ends. The dock paced them over
// the months the statements cover; the report's finding over the months to today, so the same two
// $12 fees read $288 a year in the dock and $144 on the report. Both now end where the data does.

const CHECKING = { id: "chk", name: "Checking", type: "depository", subtype: "checking" };
const CARD = { id: "card", name: "Card", type: "credit", subtype: "credit card" };
const FEE = "BANK_FEES_OTHER_BANK_FEES";
const INTEREST = "BANK_FEES_INTEREST_CHARGE";
// Two charges 26 days apart: about a month of statements.
const rows = (accountId: string, pfc: string, cents: number) =>
  ["2026-09-01", "2026-09-27"].map((date) => ({
    date,
    amountCents: cents,
    description: pfc === FEE ? "MONTHLY SERVICE FEE" : "INTEREST CHARGE",
    pfc,
    accountId,
  }));

const report = (today: string, accountId: string, pfc: string, cents: number) =>
  detect({
    asOf: today,
    historyFrom: "2026-09-01",
    accounts: [CHECKING, CARD].map((a) => ({ ...a, currentBalanceCents: 0 })),
    transactions: rows(accountId, pfc, cents).map((t, i) => ({
      id: String(i),
      accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: cents,
      description: t.description,
      merchantName: null,
      pfcPrimary: "BANK_FEES",
      pfcDetailed: pfc,
      categorySource: "rule",
    })),
    recurringStreams: [],
  } satisfies DetectionInput);

const dock = (today: string, topic: string, accountId: string, pfc: string, cents: number) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today,
    accounts: [CHECKING, CARD].map((a) => ({ ...a, balanceCents: 0 })),
    transactions: rows(accountId, pfc, cents),
    extras: { ...base.extras!, cardInterestYearCents: null },
  };
  return DETECTORS.find((d) => d.topic === topic)!.detect({ profile: buildProfile(data), data })
    ?.worthCents;
};

describe("fees in statements that ended weeks ago", () => {
  it("are paced over the month the statements cover, on the report", () => {
    const [finding] = report("2026-11-12", "chk", FEE, 1_200).filter((c) => c.type === "bank_fees");
    expect(finding?.evidence.months).toBe(1);
    expect(finding?.annualSavingsCents).toBe(2_400 * 12);
  });

  it("read the same a year on the report and in the dock", () => {
    const [finding] = report("2026-11-12", "chk", FEE, 1_200).filter((c) => c.type === "bank_fees");
    expect(dock("2026-11-12", "bank_fees", "chk", FEE, 1_200)).toBe(finding?.annualSavingsCents);
  });

  it("still run to today when the data is only quiet for a few weeks", () => {
    const [finding] = report("2026-10-20", "chk", FEE, 1_200).filter((c) => c.type === "bank_fees");
    expect(finding?.evidence.months).toBe(2);
  });
});

describe("card interest in statements that ended weeks ago", () => {
  it("reads the same a year on the report and in the dock", () => {
    const [finding] = report("2026-11-12", "card", INTEREST, 4_000).filter(
      (c) => c.type === "card_interest",
    );
    expect(finding?.annualSavingsCents).toBe(8_000 * 12);
    expect(dock("2026-11-12", "card_interest", "card", INTEREST, 4_000)).toBe(8_000 * 12);
  });
});
