import { describe, expect, it } from "vitest";
import { readCsvFile } from "./csv-source";

// Main's property test, 11-13 (seed -1310177975, control-totals.property.test.ts): a file whose
// rows are all on one day, +$0.02, -$0.02, -$1,999.97, +$1,999.97 from $0.00. The rows cancel out,
// so no row alone is the day's last one, and the file's order has to decide. With every row on
// one date the dates can't say which way the file runs; the balances can. Newest first, the day
// closed at $0.02, its first row, instead of $0.00.

const rows = [
  { cents: 2, balance: 2 },
  { cents: -2, balance: 0 },
  { cents: -199_997, balance: -199_997 },
  { cents: 199_997, balance: 0 },
];
const money = (cents: number) => `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toFixed(2)}`;
const chase = (listed: typeof rows) =>
  [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...listed.map(
      (r, i) => `DEBIT,01/02/2026,ROW ${i},${money(r.cents)},MISC,${money(r.balance)},`,
    ),
  ].join("\n");
const closing = (text: string) => {
  const result = readCsvFile({ name: "s.csv", text });
  if (!result.ok) throw new Error(result.error);
  return { warnings: result.control.warnings, last: result.balances?.at(-1)?.balanceCents };
};

describe("a day whose rows cancel out, in a file of one day", () => {
  it("closes at its last balance listed oldest first", () => {
    expect(closing(chase(rows))).toEqual({ warnings: [], last: 0 });
  });

  it("closes at its last balance listed newest first", () => {
    expect(closing(chase([...rows].reverse()))).toEqual({ warnings: [], last: 0 });
  });
});
