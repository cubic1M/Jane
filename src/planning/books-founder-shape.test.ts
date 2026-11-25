import { describe, expect, it } from "vitest";
import { netWorth, netWorthCovers } from "@/insights/net-worth";
import { withoutCopies } from "@/lib/account-copies";
import { countingProblems } from "@/sweep/counted";
import { accountsLeftOut, type CountAcct } from "./books";

// The founder's Home on the live site (11-24): "Counts 5 bank accounts ... 3 pairs of your accounts
// may be the same account; net worth counts both of each", with one or two accounts linked and the
// rest uploaded. Both shapes, in every order the accounts come back in: net worth counts the linked
// accounts only, the "Counts" line says so, and an upload is never counted because the account it
// pairs with was itself left out.

type Row = CountAcct & { currentBalanceCents: number };
const row = (id: string, over: Partial<Row>): Row => ({
  id,
  itemId: null,
  source: "csv",
  name: "Chase checking",
  mask: null,
  type: "depository",
  subtype: "checking",
  currentBalanceCents: 100_000,
  ...over,
});
const bankOf = (a: CountAcct) => (a.itemId ? "Chase" : null);

const SHAPES: Record<string, { rows: Row[]; linked: number; netCents: number; covers: string }> = {
  "1 link and 4 uploads, three pairs": {
    rows: [
      row("l1", {
        itemId: "item1",
        source: "plaid",
        name: "TOTAL CHECKING",
        mask: "1234",
        currentBalanceCents: 485_000,
      }),
      row("u1", { currentBalanceCents: 120_000 }),
      row("u2", { name: "Chase checking 2", currentBalanceCents: 130_000 }),
      row("u3", { name: "Chase Total Checking", currentBalanceCents: 90_000 }),
      row("u4", { name: "Chase checking statement", currentBalanceCents: 110_000 }),
    ],
    linked: 1,
    netCents: 485_000,
    covers: "Counts 1 bank account. No investment or retirement account is in it.",
  },
  "2 links and 3 uploads, three pairs": {
    rows: [
      row("l1", {
        itemId: "item1",
        source: "plaid",
        name: "TOTAL CHECKING",
        mask: "1234",
        currentBalanceCents: 485_000,
      }),
      row("l2", {
        itemId: "item1",
        source: "plaid",
        name: "SAVINGS",
        mask: "5678",
        subtype: "savings",
        currentBalanceCents: 900_000,
      }),
      row("u1", { currentBalanceCents: 120_000 }),
      row("u2", { name: "Chase savings", subtype: "savings", currentBalanceCents: 880_000 }),
      row("u3", { name: "Chase checking 2", currentBalanceCents: 130_000 }),
    ],
    linked: 2,
    netCents: 485_000 + 900_000,
    covers: "Counts 2 bank accounts. No investment or retirement account is in it.",
  },
};
// Every order the database may return them in, by id order and by row order.
const shuffles = (rows: Row[]) =>
  [0, 1, 2, 3, 4].map((turn) => [...rows.slice(turn), ...rows.slice(0, turn)].reverse());

describe.each(Object.entries(SHAPES))("the founder's shape: %s", (_name, shape) => {
  it.each(shuffles(shape.rows).map((rows, i) => [i, rows] as const))(
    "order %s: only the linked accounts count, and the Counts line says so",
    (_i, rows) => {
      const left = accountsLeftOut(rows, { bankOf });
      const kept = withoutCopies(rows, new Set(left.keys()), (a) => a.id);
      expect(kept.map((a) => a.id).sort()).toEqual(
        rows
          .filter((a) => a.itemId)
          .map((a) => a.id)
          .sort(),
      );
      expect(kept).toHaveLength(shape.linked);
      const accounts = kept.map((a) => ({ ...a, balanceCents: a.currentBalanceCents }));
      expect(netWorth(accounts).netCents).toBe(shape.netCents);
      expect(netWorthCovers(accounts)).toBe(shape.covers);
      expect(countingProblems(kept, bankOf)).toEqual([]);
      // Every upload is held back for a reason that names an account that counts or the later upload.
      for (const why of left.values()) expect(rows.some((a) => a.id === why.sameAs.id)).toBe(true);
      expect(left.size).toBe(rows.length - shape.linked);
    },
  );

  it("says what Jane did in one line, with nothing for the person to do", async () => {
    const { maybeSameWords } = await import("@/insights/net-worth");
    const left = accountsLeftOut(shape.rows, { bankOf });
    const said = maybeSameWords(
      [...left].map(([id, why]) => ({
        reason: why.reason as "maybe_same",
        left: { name: id },
        with: { name: why.sameAs.name },
      })),
    );
    expect(said).toMatch(/left out of net worth/);
    expect(said).not.toMatch(/remove|say so|if it is/i);
  });
});
