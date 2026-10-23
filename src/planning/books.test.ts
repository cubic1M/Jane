import { describe, expect, it } from "vitest";
import {
  duplicateAccounts,
  linkProblems,
  matchTransfers,
  provenSame,
  reconcile,
  type Acct,
  type Tx,
} from "./books";

// Spec step 238, pure: balances against transactions, the same account linked twice, two
// copies proven alike before anything is merged, transfers matched in pairs, broken links.

const tx = (
  id: string,
  accountId: string,
  date: string,
  amountCents: number,
  description = "SHOP",
  pfcPrimary: string | null = null,
): Tx => ({
  id,
  accountId,
  date,
  amountCents,
  description,
  pfcPrimary,
});

describe("reconcile", () => {
  const snaps = [
    { date: "2026-10-01", balanceCents: 100_000 },
    { date: "2026-10-10", balanceCents: 80_000 },
  ];

  it("passes when the balance moved by exactly what the transactions say", () => {
    expect(reconcile("depository", snaps, [tx("a", "x", "2026-10-05", 20_000)])).toBeNull();
    // A card's balance owed rises with charges.
    expect(
      reconcile(
        "credit",
        [
          { date: "2026-10-01", balanceCents: 0 },
          { date: "2026-10-10", balanceCents: 20_000 },
        ],
        [tx("a", "x", "2026-10-05", 20_000)],
      ),
    ).toBeNull();
  });

  it("finds a balance that's off, and by how much", () => {
    const found = reconcile("depository", snaps, [tx("a", "x", "2026-10-05", 12_000)])!;
    expect(found).toMatchObject({ kind: "off", offByCents: -8_000, transactionsCents: 12_000 });
  });

  it("calls it a gap when the balance moved and no transactions came", () => {
    expect(reconcile("depository", snaps, [])).toMatchObject({ kind: "gap", offByCents: -20_000 });
  });

  it("lets a dollar of rounding go", () => {
    expect(reconcile("depository", snaps, [tx("a", "x", "2026-10-05", 19_950)])).toBeNull();
  });
});

describe("duplicateAccounts", () => {
  const acct = (
    id: string,
    itemId: string,
    mask: string | null,
    over: Partial<Acct> = {},
  ): Acct => ({
    id,
    itemId,
    name: "Checking",
    mask,
    type: "depository",
    subtype: "checking",
    ...over,
  });
  it("finds the same account at two links, and leaves others alone", () => {
    const found = duplicateAccounts([
      acct("a", "i1", "1234"),
      acct("b", "i2", "1234"),
      acct("c", "i2", "9999"),
      acct("d", "i3", "1234", { subtype: "savings" }),
      acct("e", "i1", null),
      acct("f", "i2", null),
    ]);
    expect(found.map((f) => [f.keep.id, f.duplicate.id])).toEqual([["a", "b"]]);
  });
});

describe("provenSame", () => {
  const keep = [
    tx("k1", "a", "2026-10-01", 500, "Coffee"),
    tx("k2", "a", "2026-10-03", 1_200, "Lunch"),
    tx("k3", "a", "2026-10-09", 900, "Gas"),
  ];
  it("proves two copies alike when every transaction has its twin", () => {
    const dup = [
      tx("d1", "b", "2026-10-03", 1_200, "lunch"),
      tx("d2", "b", "2026-10-09", 900, "Gas"),
    ];
    expect(provenSame(keep, dup)).toMatchObject({ ok: true, unmatched: [] });
  });
  it("does not when one has a transaction the other doesn't", () => {
    const dup = [
      tx("d1", "b", "2026-10-03", 1_200, "Lunch"),
      tx("d2", "b", "2026-10-05", 4_000, "Rent"),
    ];
    const out = provenSame(keep, dup);
    expect(out.ok).toBe(false);
    expect(out.unmatched.map((t) => t.id)).toEqual(["d2"]);
  });
  it("does not when the kept account has one the copy lacks within the copy's dates", () => {
    expect(
      provenSame(keep, [
        tx("d1", "b", "2026-10-01", 500, "Coffee"),
        tx("d3", "b", "2026-10-09", 900, "Gas"),
      ]).ok,
    ).toBe(false);
  });
  it("lists the copy's older ones to move, and refuses an empty side", () => {
    const dup = [
      tx("d0", "b", "2026-09-20", 700, "Old"),
      tx("d1", "b", "2026-10-03", 1_200, "Lunch"),
      tx("d2", "b", "2026-10-09", 900, "Gas"),
      tx("d4", "b", "2026-10-01", 500, "Coffee"),
    ];
    expect(provenSame(keep, dup)).toMatchObject({ ok: true });
    expect(provenSame(keep, dup).extra.map((t) => t.id)).toEqual(["d0"]);
    expect(provenSame(keep, []).ok).toBe(false);
  });
});

describe("matchTransfers", () => {
  it("matches a transfer out with the same amount in at another account", () => {
    const out = tx("o", "a", "2026-10-05", 100_000, "TO SAVINGS", "TRANSFER_OUT");
    const inn = tx("i", "b", "2026-10-06", -100_000, "FROM CHECKING", "TRANSFER_IN");
    const { pairs, unmatchedOut } = matchTransfers([out, inn]);
    expect(pairs).toHaveLength(1);
    expect(unmatchedOut).toEqual([]);
  });
  it("flags a large transfer with no other side, not a small one", () => {
    const big = tx("o", "a", "2026-10-05", 100_000, "TO SOMEWHERE", "TRANSFER_OUT");
    const small = tx("s", "a", "2026-10-06", 2_000, "VENMO", "TRANSFER_OUT");
    expect(matchTransfers([big, small]).unmatchedOut.map((t) => t.id)).toEqual(["o"]);
  });
  it("won't pair within one account, or across too many days", () => {
    const out = tx("o", "a", "2026-10-01", 100_000, "x", "TRANSFER_OUT");
    expect(
      matchTransfers([out, tx("i", "a", "2026-10-02", -100_000, "y", "TRANSFER_IN")]).pairs,
    ).toEqual([]);
    expect(
      matchTransfers([out, tx("i", "b", "2026-10-20", -100_000, "y", "TRANSFER_IN")]).pairs,
    ).toEqual([]);
  });
});

describe("linkProblems", () => {
  it("separates links that need a sign-in from ones that just stopped updating", () => {
    const links = [
      {
        id: "1",
        name: "A",
        status: "login_required",
        lastSyncedAt: "2026-10-10",
        createdAt: "2026-01-01",
      },
      { id: "2", name: "B", status: "active", lastSyncedAt: "2026-10-01", createdAt: "2026-01-01" },
      { id: "3", name: "C", status: "active", lastSyncedAt: "2026-10-18", createdAt: "2026-01-01" },
    ];
    const { broken, stale } = linkProblems(links, "2026-10-19");
    expect(broken.map((l) => l.id)).toEqual(["1"]);
    expect(stale.map((l) => l.id)).toEqual(["2"]);
  });
});
