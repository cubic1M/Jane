import { describe, expect, it } from "vitest";
import { namedPayees } from "./backup";

// The chat's fourth policy round (11-06), with Claude refusing so the rules answered: "do i need
// to pay state estimated tax" got "$20,240.00 came in from State (11 payments)": the pension
// from State Teachers Retirement. "State" and "federal" on their own name no one; the payee's
// whole name still does.
const row = (description: string, amountCents: number, merchantName: string | null = null) => ({
  date: "2026-09-01",
  amountCents,
  description,
  merchantName,
});
const ROWS = [
  row("STATE TEACHERS RETIREMENT", -184_000),
  row("STATE FARM AUTO", 14_200, "State Farm"),
  row("FEDERAL STUDENT AID", 31_000),
];

describe("state and federal aren't payees on their own", () => {
  it.each([
    "do i need to pay state estimated tax",
    "when is my state tax due",
    "how much federal tax will i owe",
    "state or federal first?",
  ])("%s names no one", (text) => {
    expect(namedPayees(text, ROWS)).toEqual([]);
  });

  it.each([
    ["how much did state farm charge me", "State Farm"],
    ["what did state teachers pay me this year", "State Teachers"],
    ["federal student aid payments", "Federal Student Aid"],
  ])("%s names who it says", (text, name) => {
    expect(namedPayees(text, ROWS)[0]?.name).toBe(name);
  });
});
