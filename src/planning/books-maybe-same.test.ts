import { describe, expect, it } from "vitest";
import { maybeSameHref, maybeSameWords } from "@/insights/net-worth";
import { maybeSameAccounts, type Acct } from "./books";

// The founder's Home read about twice the truth (11-23). An account counted once is the copy rule's
// (same last four, type and subtype at two links); these are the ways one account still got in
// twice, each said, never merged, and the ones that are really two accounts, which must not be.

const banks: Record<string, string | undefined> = { i1: "Chase", i2: "Chase", i3: "Wells Fargo" };
const bank = (a: Acct) => banks[a.itemId ?? ""] ?? null;
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

  it("does not flag a checking and a savings account at one bank with the same last four", () => {
    expect(
      names([
        acct("a", "i1", "Checking", "1234"),
        acct("b", "i2", "Savings", "1234", { subtype: "savings" }),
      ]),
    ).toEqual([]);
    expect(
      names([
        acct("a", "i1", "Checking", "1234"),
        acct("b", "i2", "Money market", "1234", { subtype: "money market" }),
      ]),
    ).toEqual([]);
  });

  it("says where to look: an upload on the import page, a second link in Settings", () => {
    const up = { reason: "maybe_same" as const, left: { name: "A" }, with: { name: "B" } };
    const link = { ...up, reason: "linked_twice" as const };
    expect([maybeSameHref([up]), maybeSameHref([link])]).toEqual(["/import", "/settings#banks"]);
  });

  it("says what Jane did, with no chore for the person", () => {
    const left = { left: { name: "Chase checking" }, with: { name: "TOTAL CHECKING" } };
    expect(maybeSameWords([{ ...left, reason: "maybe_same" }])).toBe(
      "Chase checking (uploaded) looks like a copy of TOTAL CHECKING (linked), and there was not enough in their lines to be sure, so Jane left it out of net worth.",
    );
    expect(maybeSameWords([{ ...left, reason: "older_upload" }])).toBe(
      "Chase checking (uploaded) looks like an earlier upload of TOTAL CHECKING, so Jane counted the later one only.",
    );
    expect(maybeSameWords([{ ...left, reason: "same_account" }])).toBe(
      "Chase checking (uploaded) shows the same activity as TOTAL CHECKING (linked), so Jane left it out of net worth.",
    );
    const three = [1, 2, 3].map(() => ({ ...left, reason: "same_account" as const }));
    expect(maybeSameWords(three)).toBe(
      "3 uploaded statements look like copies of your linked accounts, so they are left out of net worth.",
    );
    expect(maybeSameWords([...three.slice(0, 2), { ...left, reason: "maybe_same" }])).toBe(
      "3 uploaded statements look like copies of your linked accounts, so they are left out of net worth. Jane could not be sure of 1 of them from the bank's own lines.",
    );
    expect(maybeSameWords([])).toBeNull();
    expect(maybeSameWords(three)).not.toMatch(/remove|say so|if it is/i);
  });
});
