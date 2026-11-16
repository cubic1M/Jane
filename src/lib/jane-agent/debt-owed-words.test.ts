import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { debtsReply } from "./debt-replies";

// Debug 2 (11-16, a Plaid sandbox student loan and car loan, the side chat at 1280 light): "how
// much do I owe in total?" → "You owe $28,933.74 on 2 loans and cards". There's no card. The
// answer says what the debts are: "2 loans", "1 card", or "loans and cards" when it's both.

const account = (id: string, type: string, subtype: string, cents: number): DebtAccountInput => ({
  id,
  name: `Plaid ${subtype}`,
  mask: id,
  type,
  subtype,
  currentBalanceCents: cents,
  liability: null,
});
const STUDENT = account("4907", "loan", "student", 1_605_374);
const AUTO = account("5659", "loan", "auto", 1_288_000);
const CARD = account("2000", "credit", "credit card", 185_040);
const first = (accounts: DebtAccountInput[]) =>
  debtsReply(debtBook({ accounts, plans: [], typed: [] }, "2026-11-16")).body.split("\n")[0];

describe("what the debts are, in how much do I owe", () => {
  it("says loans when there's no card", () => {
    expect(first([STUDENT, AUTO])).toBe(
      "You owe $28,933.74 on 2 loans, the same as your net worth counts.",
    );
  });

  it("says a card when it's only a card, and both when it's both", () => {
    expect(first([CARD])).toBe("You owe $1,850.40 on 1 card, the same as your net worth counts.");
    expect(first([AUTO, CARD])).toContain("on 2 loans and cards");
  });
});
