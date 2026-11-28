import { describe, expect, it } from "vitest";
import type { NormalizedAccount, NormalizedTransaction } from "@/data-sources/types";
import { ReplaceRefused, matchAccounts, matchTwins, planLeftovers } from "./replace";

const old = (id: string, over: object = {}) => ({
  id,
  plaidAccountId: `old-${id}`,
  type: "depository",
  subtype: "checking",
  mask: "0000",
  name: "Plaid Checking",
  ...over,
});
const fresh = (ref: string, over: Partial<NormalizedAccount> = {}): NormalizedAccount => ({
  ref,
  name: "Plaid Checking",
  kind: "checking",
  mask: "0000",
  currentBalanceCents: 100,
  ...over,
});

describe("matching a new link's accounts to the ones Jane holds", () => {
  it("pairs them one for one on type, subtype, last four digits and name", () => {
    const map = matchAccounts(
      [old("a"), old("b", { subtype: "savings", mask: "1111", name: "Plaid Saving" })],
      [fresh("n2", { kind: "savings", mask: "1111", name: "plaid saving" }), fresh("n1")],
    );
    expect([...map]).toEqual([
      ["a", "n1"],
      ["b", "n2"],
    ]);
  });

  it("refuses on any doubt: a different count, mask, name or kind, or two that fit", () => {
    const refused = (o: ReturnType<typeof old>[], n: NormalizedAccount[]) =>
      expect(() => matchAccounts(o, n)).toThrow(ReplaceRefused);
    refused([old("a")], []);
    refused([old("a")], [fresh("n1"), fresh("n2", { mask: "9999" })]);
    refused([old("a")], [fresh("n1", { mask: "9999" })]);
    refused([old("a")], [fresh("n1", { name: "Another name" })]);
    refused([old("a")], [fresh("n1", { kind: "savings" })]);
    refused([old("a"), old("b")], [fresh("n1"), fresh("n2")]);
    refused([], [fresh("n1")]);
  });
});

const row = (id: string, description: string, over: object = {}) => ({
  id,
  accountId: "acc",
  date: new Date("2026-10-19T00:00:00Z"),
  amountCents: 2000,
  description,
  categorySource: null as string | null,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  pending: false,
  ...over,
});
const incoming = (externalId: string, description: string, over: object = {}) =>
  ({
    externalId,
    accountId: "acc",
    date: "2026-10-19",
    amountCents: 2000,
    description,
    ...over,
  }) as unknown as NormalizedTransaction & { accountId: string };

describe("matching new transactions to their twins", () => {
  it("pairs on account, day, amount and the words of the description", () => {
    const twins = matchTwins(
      [row("r1", "NETFLIX.COM  #123"), row("r2", "Other", { amountCents: 1 })],
      [incoming("n1", "netflix.com 123"), incoming("n2", "Other")],
    );
    expect([...twins]).toEqual([["n1", "r1"]]);
  });

  it("gives alike rows one for one, the person's own edited row first, and leaves the extra ones", () => {
    const twins = matchTwins(
      [
        row("plain", "COFFEE", { createdAt: new Date("2026-10-01") }),
        row("edited", "COFFEE", { categorySource: "user", createdAt: new Date("2026-10-02") }),
      ],
      [incoming("n1", "COFFEE"), incoming("n2", "COFFEE"), incoming("n3", "COFFEE")],
    );
    expect(twins.get("n1")).toBe("edited");
    expect(twins.get("n2")).toBe("plain");
    expect(twins.has("n3")).toBe(false);
  });

  it("keeps letters of every script apart, and accents", () => {
    const twins = matchTwins(
      [
        row("denryoku", "東京電力"),
        row("gas", "東京ガス"),
        row("cafe", "Cafe", { amountCents: 999 }),
      ],
      [incoming("n1", "東京ガス"), incoming("n2", "東京電力"), incoming("n3", "Café")],
    );
    expect(twins.get("n1")).toBe("gas");
    expect(twins.get("n2")).toBe("denryoku");
    expect(twins.has("n3")).toBe(false);
  });

  it("gives a posted charge the old row of the pending one it replaced, even if day and amount moved", () => {
    const twins = matchTwins(
      [row("old-pending", "DINNER", { categorySource: "user", pending: true })],
      [
        incoming("P", "DINNER", { pending: true }),
        incoming("Q", "DINNER", {
          pending: false,
          pendingExternalId: "P",
          amountCents: 2300,
          date: "2026-10-20",
        }),
      ],
    );
    // Q takes it; P is never paired (it would be the same charge twice).
    expect([...twins]).toEqual([["Q", "old-pending"]]);
  });

  it("lets a replacing posted charge take the pending row before an ordinary charge can", () => {
    // An ordinary charge A has the same key as the person's pending row U and a plain posted row V.
    const twins = matchTwins(
      [
        row("U", "DINNER", { pending: true, categorySource: "user" }),
        row("V", "DINNER", { createdAt: new Date("2026-10-25") }),
      ],
      [
        incoming("A", "DINNER"),
        incoming("P", "DINNER", { pending: true }),
        incoming("Q", "DINNER", { pending: false, pendingExternalId: "P", amountCents: 2300 }),
      ],
    );
    expect(twins.get("Q")).toBe("U");
    expect(twins.get("A")).toBe("V");
  });

  it("matches a charge that says it replaced a pending one the read no longer lists, within a week and a third", () => {
    const old = row("U", "DINNER", { pending: true, categorySource: "user" });
    const posted = (over: object) =>
      incoming("Q", "DINNER", {
        pending: false,
        pendingExternalId: "gone",
        amountCents: 2400,
        date: "2026-10-21",
        ...over,
      });
    expect(matchTwins([old], [posted({})]).get("Q")).toBe("U");
    // Too far away in time, too different in amount, another place, or not marked as a replacement.
    expect(matchTwins([old], [posted({ date: "2026-11-05" })]).size).toBe(0);
    expect(matchTwins([old], [posted({ amountCents: 5000 })]).size).toBe(0);
    expect(matchTwins([old], [posted({ description: "BREAKFAST" })]).size).toBe(0);
    expect(matchTwins([old], [posted({ pendingExternalId: null })]).size).toBe(0);
  });

  it("does not pair across accounts or days", () => {
    expect(
      matchTwins(
        [row("r1", "X")],
        [incoming("n1", "X", { accountId: "other" }), incoming("n2", "X", { date: "2026-10-30" })],
      ).size,
    ).toBe(0);
  });

  it("pairs a charge the new read words differently, or dates a day or two apart, one for one", () => {
    const twins = matchTwins(
      [row("a", "COFFEE SHOP"), row("b", "COFFEE SHOP"), row("c", "BOOKS", { amountCents: 500 })],
      [
        incoming("n1", "Coffee Shop #4411 SF", { date: "2026-10-21" }),
        incoming("n2", "Coffee Shop #4411 SF", { date: "2026-10-19" }),
        incoming("n3", "Barnes", { amountCents: 500, date: "2026-10-22" }),
      ],
    );
    // Nearest first: the same day takes its row, the two-day gap the other; three days is still a twin.
    expect(twins.get("n2")).toBe("a");
    expect(twins.get("n1")).toBe("b");
    expect(twins.get("n3")).toBe("c");
  });

  it("does not pair past the slack, across amounts, or twice", () => {
    const twins = matchTwins(
      [row("a", "COFFEE")],
      [
        incoming("n1", "Other", { date: "2026-10-23" }),
        incoming("n2", "Other", { date: "2026-10-23", amountCents: 2001 }),
        incoming("n3", "Other", { date: "2026-10-22" }),
      ],
    );
    // 10-23 is four days off; 10-22 is three: only that one pairs, and only once.
    expect([...twins]).toEqual([["n3", "a"]]);
  });

  it("never makes a posted row the twin of a pending arrival", () => {
    const twins = matchTwins(
      [row("posted", "COFFEE")],
      [
        incoming("p1", "COFFEE", { pending: true }),
        incoming("p2", "Coffee shop", { pending: true, date: "2026-10-20" }),
      ],
    );
    expect(twins.size).toBe(0);
  });

  it("prefers the person's touched row among equals", () => {
    const twins = matchTwins(
      [
        row("plain", "X", { createdAt: new Date("2026-10-01") }),
        row("mine", "X", { touched: true }),
      ],
      [incoming("n1", "Y", { date: "2026-10-20" })],
    );
    expect(twins.get("n1")).toBe("mine");
  });
});

describe("what becomes of an old row with no twin", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const first = new Map([["acc", "2025-12-05"]]);
  const plaidRow = (id: string, over: object = {}) =>
    row(id, "X", { plaidTransactionId: `old-${id}`, ...over });

  it("never drops a posted row: one inside the new read's days is a hole, the rest are kept", () => {
    const rows = [
      plaidRow("inside", { date: new Date("2026-03-01T00:00:00Z") }),
      plaidRow("older", { date: new Date("2025-06-01T00:00:00Z") }),
      plaidRow("mine", { date: new Date("2026-03-01T00:00:00Z"), touched: true }),
      plaidRow("twin", { date: new Date("2026-03-01T00:00:00Z") }),
    ];
    expect(planLeftovers(rows, new Set(["twin"]), first, now)).toEqual({
      drop: [],
      ghost: [],
      keep: ["older"],
      holes: ["inside", "mine"],
    });
  });

  it("keeps a row after the last day the new read reaches", () => {
    const rows = [plaidRow("late", { date: new Date("2026-11-20T00:00:00Z") })];
    const last = new Map([["acc", "2026-11-10"]]);
    expect(planLeftovers(rows, new Set(), first, now, last).keep).toEqual(["late"]);
    expect(planLeftovers(rows, new Set(), first, now).holes).toEqual(["late"]);
  });

  it("keeps an account the new read says nothing about", () => {
    const rows = [plaidRow("x", { accountId: "other", date: new Date("2026-03-01T00:00:00Z") })];
    expect(planLeftovers(rows, new Set(), first, now).keep).toEqual(["x"]);
  });

  it("keeps a pending row younger than ten days, or touched, and drops an old untouched one", () => {
    const rows = [
      plaidRow("young", { pending: true, date: new Date("2026-11-25T00:00:00Z") }),
      plaidRow("mine", { pending: true, date: new Date("2026-10-01T00:00:00Z"), touched: true }),
      plaidRow("old", { pending: true, date: new Date("2026-10-01T00:00:00Z") }),
    ];
    expect(planLeftovers(rows, new Set(), first, now)).toEqual({
      drop: ["old"],
      ghost: ["young", "mine"],
      keep: [],
      holes: [],
    });
  });
});
