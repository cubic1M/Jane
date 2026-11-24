import { describe, expect, it } from "vitest";
import { maybeSameWords } from "@/insights/net-worth";
import { maybeSameAccounts, type Acct } from "./books";

// The founder's Home read about twice the truth (11-23). An account counted once is the copy rule's
// (same last four, type and subtype at two links); these are the ways one account still got in
// twice, each said, never merged, and the ones that are really two accounts, which must not be.

const bank = (a: Acct) => ({ i1: "Chase", i2: "Chase", i3: "Wells Fargo" })[a.itemId ?? ""] ?? null;
const acct = (
  id: string,
  itemId: string | null,
  name: string,
  mask: string | null,
  over: Partial<Acct> = {},
): Acct => ({
  id,
  itemId,
  name,
  mask,
  type: "depository",
  subtype: "checking",
  ...over,
});
const names = (accounts: Acct[]) =>
  maybeSameAccounts(accounts, bank).map(({ a, b }) => [a.name, b.name]);

describe("accounts that may be one account counted twice", () => {
  it("flags an upload with no last four beside a link of the same bank and type", () => {
    expect(
      names([acct("a", null, "Chase checking", null), acct("b", "i1", "TOTAL CHECKING", "1234")]),
    ).toEqual([["Chase checking", "TOTAL CHECKING"]]);
  });

  it("flags the same last four when Plaid now names the subtype differently", () => {
    expect(
      names([
        acct("a", "i1", "Checking", "1234"),
        acct("b", "i2", "Checking", "1234", { subtype: "cash management" }),
      ]),
    ).toHaveLength(1);
  });

  it("flags two uploads, and two links with no last four, that look alike", () => {
    expect(
      names([acct("a", null, "Chase checking", "1234"), acct("b", null, "Chase checking 2", null)]),
    ).toHaveLength(1);
    expect(
      names([acct("a", "i1", "Checking", null), acct("b", "i2", "Checking", null)]),
    ).toHaveLength(1);
  });

  it("does not flag two accounts: other last fours, other kinds, other banks, one link", () => {
    expect(
      names([acct("a", "i1", "Checking", "1234"), acct("b", "i1", "Checking", "5678")]),
    ).toEqual([]);
    expect(
      names([acct("a", null, "Chase checking", "1234"), acct("b", "i1", "Checking", "5678")]),
    ).toEqual([]);
    expect(
      names([
        acct("a", null, "Chase checking", null),
        acct("b", "i1", "Savings", null, { subtype: "savings" }),
      ]),
    ).toEqual([]);
    expect(
      names([acct("a", null, "Chase checking", null), acct("b", "i3", "Checking", "1234")]),
    ).toEqual([]);
    expect(names([acct("a", "i1", "Checking", null), acct("b", "i1", "Checking 2", null)])).toEqual(
      [],
    );
  });

  it("says each pair by name, both counted, and how to remove one", () => {
    const [pair] = maybeSameAccounts(
      [acct("a", null, "Chase checking", null), acct("b", "i1", "TOTAL CHECKING", "1234")],
      bank,
    );
    expect(maybeSameWords([pair!])).toBe(
      "Chase checking (uploaded) and TOTAL CHECKING (linked) may be the same account; net worth counts both. If they are the same, remove one.",
    );
    expect(maybeSameWords([])).toBeNull();
  });
});
