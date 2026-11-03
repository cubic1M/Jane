import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readCsvFile } from "./csv-source";

// Any statement that really adds up says nothing, in any order; take a row out of one and it says
// so; and every row in a file is accounted for, whatever's in it.

const money = (cents: number) => {
  const text = (Math.abs(cents) / 100).toFixed(2);
  return cents < 0 ? `-${text}` : text;
};

// Rows that happened, in date order, with the balance after each, as a bank keeps them.
const statement = fc
  .record({
    opening: fc.integer({ min: -50_000, max: 5_000_000 }),
    rows: fc.array(
      fc.record({
        // Over a cent: a cent either way is rounding (CONTROL_TOLERANCE_CENTS).
        cents: fc.integer({ min: -200_000, max: 200_000 }).filter((c) => Math.abs(c) > 1),
        gap: fc.integer({ min: 0, max: 3 }),
      }),
      { minLength: 4, maxLength: 40 },
    ),
  })
  .map(({ opening, rows }) => {
    let balance = opening;
    let day = Date.UTC(2026, 0, 2);
    return rows.map(({ cents, gap }, i) => {
      balance += cents;
      day += gap * 86_400_000;
      const d = new Date(day);
      const date = `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
      // The rows of a day differ by name only; each day's closing row can be told by the balance.
      return { date, what: `ROW ${i}`, cents, balance };
    });
  });

type Row = { date: string; what: string; cents: number; balance: number };
const chase = (rows: readonly Row[]) =>
  [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...rows.map((r) => `DEBIT,${r.date},${r.what},${money(r.cents)},MISC,${money(r.balance)},`),
  ].join("\n");

const read = (text: string) => {
  const result = readCsvFile({ name: "s.csv", text });
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("a running balance", () => {
  it("says nothing of a statement that adds up, oldest or newest first", () => {
    fc.assert(
      fc.property(statement, (rows) => {
        const older = read(chase(rows));
        const newer = read(chase([...rows].reverse()));
        expect(older.control.warnings).toEqual([]);
        expect(newer.control.warnings).toEqual([]);
        expect(older.balances?.at(-1)?.balanceCents).toBe(rows[rows.length - 1]!.balance);
        expect(newer.balances?.at(-1)?.balanceCents).toBe(rows[rows.length - 1]!.balance);
      }),
    );
  });

  it("warns when any row in the middle is taken out", () => {
    fc.assert(
      fc.property(statement, fc.nat(), (rows, pick) => {
        // Not the first or last: nothing is left to show the first was ever there.
        const gone = 1 + (pick % (rows.length - 2));
        const without = rows.filter((_, i) => i !== gone);
        const codes = read(chase(without)).control.warnings.map((w) => w.code);
        expect(codes.some((c) => c === "balance_gap" || c === "not_a_balance")).toBe(true);
      }),
    );
  });
});

describe("row counts", () => {
  const noise = fc.oneof(
    fc.constant("Total,,,1.00,,,"),
    fc.constant("Ending balance,,,1.00,,,"),
    fc.constant("not,a,row"),
    fc.constant("DEBIT,13/45/2026,BAD DAY,1.00,MISC,1.00,"),
    fc.constant("DEBIT,01/02/2026,BAD AMOUNT,lots,MISC,1.00,"),
    fc.constant("Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"),
  );

  it("accounts for every row in a file, whatever's in it", () => {
    fc.assert(
      fc.property(statement, fc.array(noise, { maxLength: 10 }), fc.nat(), (rows, extra, at) => {
        const lines = chase(rows).split("\n");
        const body = lines.slice(1);
        for (const line of extra) body.splice(at % (body.length + 1), 0, line);
        const { control, transactions, skipped } = read([lines[0], ...body].join("\n"));
        const { inFile, read: kept, skipped: bad, leftOut } = control.rows;
        expect(inFile).toBe(body.length);
        expect(kept).toBe(transactions.length);
        expect(bad).toBe(skipped.length);
        expect(kept + bad + leftOut).toBe(inFile);
      }),
    );
  });
});
