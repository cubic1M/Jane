import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { BANK_FEE_CATEGORIES } from "@/config/detection";
import { inList } from "@/detection/helpers";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

const bankFees = DETECTORS.find((d) => d.topic === "bank_fees")!;

// Debug 2, fifth desktop sweep (11-17, upload S7: one Bank of America checking statement): the
// dock said "Stop paying bank and card fees, save $144/yr" for a $12.00 monthly maintenance fee,
// with no card at all. "Card" is for a card fee.
describe("the bank fees suggestion with only a checking account's fees", () => {
  const base = inputFor("renter");
  const checking = base.accounts.find((a) => a.type === "depository")!;
  const noFees = base.transactions.filter((t) => !inList(t.pfc, BANK_FEE_CATEGORIES));
  const maintenance = ["06-20", "07-20", "08-20", "09-20", "10-20"].map((d) => ({
    date: `2026-${d}`,
    amountCents: 1_200,
    description: "MONTHLY MAINTENANCE FEE",
    pfc: "BANK_FEES_OTHER_BANK_FEES",
    accountId: checking.id,
  }));

  it("says bank fees, not card fees", () => {
    const data = { ...base, transactions: [...noFees, ...maintenance] };
    expect(bankFees.detect({ profile: buildProfile(data), data })?.title).toBe(
      "Stop paying bank fees",
    );
  });
});
