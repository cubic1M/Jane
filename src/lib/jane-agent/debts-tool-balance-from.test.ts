import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { formatCents } from "@/lib/money";
import { debtsToolOutput } from "./debt-tool-outputs";

// Walk batch 1 (11-18, cell S2, live through chat-eval): with a Chase card uploaded and its balance
// skipped, Claude said "Your bank hasn't given me a balance or a rate for it": the debts tool gave
// no source for a balance, and every account's balance counted as the bank's. An uploaded card's
// balance is its statement's, and a missing one is added on the import page.

const AS_OF = "2026-11-18";
const card = (
  source: string | undefined,
  currentBalanceCents: number | null,
): DebtAccountInput => ({
  id: "chase",
  name: "Chase card",
  mask: null,
  type: "credit",
  subtype: "credit card",
  currentBalanceCents,
  ...(source ? { source } : {}),
  liability: null,
});
const [debtOf] = [
  (source: string | undefined, balance: number | null) =>
    debtsToolOutput(
      debtBook({ accounts: [card(source, balance)], plans: [], typed: [] }, AS_OF),
      formatCents,
    ).debts[0],
];

describe("where a debt's balance came from, for Claude", () => {
  it("says an uploaded card's missing balance is the file's, and where to add it", () => {
    expect(debtOf("csv", null)).toMatchObject({
      balance: null,
      balanceFrom: "not in their uploaded file, and none typed: they can add it on the import page",
    });
  });

  it("says an uploaded card's balance is from the statement, a linked card's from the bank", () => {
    expect(debtOf("csv", 124_000)).toMatchObject({
      balance: "$1,240.00",
      balanceFrom: "from your uploaded statement",
    });
    expect(debtOf("plaid", 124_000)).toMatchObject({ balanceFrom: "from your bank" });
    expect(debtOf("plaid", null)).toMatchObject({ balanceFrom: "not known yet" });
  });
});
