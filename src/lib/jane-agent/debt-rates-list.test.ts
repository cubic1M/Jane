import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { debtsReply } from "./debt-replies";

// Debug 2 re-walk (11-16, Plaid sandbox default user, 1280 light): "how much do I owe?" ended "I
// don't have a rate for Plaid auto ····5000 or Plaid consumer ····6000 or Plaid line of credit
// ····7000 or Plaid mortgage ····3000." A list reads "A, B, C or D".

const loan = (mask: string, subtype: string): DebtAccountInput => ({
  id: mask,
  name: `Plaid ${subtype}`,
  mask,
  type: "loan",
  subtype,
  currentBalanceCents: 50_000,
  liability: null,
});

const lastLine = (accounts: DebtAccountInput[]) =>
  debtsReply(debtBook({ accounts, plans: [], typed: [] }, "2026-11-16"))
    .body.split("\n")
    .at(-1);

describe("the debts with no rate, in how much do I owe", () => {
  it("are a list with one or", () => {
    expect(
      lastLine([loan("5000", "auto"), loan("6000", "consumer"), loan("7000", "line of credit")]),
    ).toBe(
      "I don't have a rate for Plaid auto ····5000, Plaid consumer ····6000 or Plaid line of credit ····7000. Add it on the loans page and I'll count it.",
    );
  });

  it("are two names with or", () => {
    expect(lastLine([loan("5000", "auto"), loan("6000", "consumer")])).toBe(
      "I don't have a rate for Plaid auto ····5000 or Plaid consumer ····6000. Add it on the loans page and I'll count it.",
    );
  });
});
