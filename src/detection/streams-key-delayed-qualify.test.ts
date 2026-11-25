import { describe, expect, it } from "vitest";
import { input, tx } from "./__fixtures__/build";
import { detectRecurring } from "./streams";

const APPLE = { merchantName: "Apple", description: "APPLE.COM/BILL" };
const charge = (date: string, amountCents: number) => tx({ ...APPLE, date, amountCents });

const keys = (asOf: string, rows: ReturnType<typeof charge>[]) =>
  new Map(
    detectRecurring(input({ asOf, transactions: rows })).map((s) => [s.lastAmountCents, s.key]),
  );

describe("a plan that qualifies later never takes the key of one already found", () => {
  const monthly = [
    charge("2026-05-01", 1_000),
    charge("2026-06-01", 1_000),
    charge("2026-07-01", 1_000),
  ];
  const lone = charge("2026-04-01", 2_000);

  it("keeps merchant:apple on the monthly plan until the older price qualifies", () => {
    expect(keys("2026-06-02", monthly.slice(0, 2).concat(lone)).get(1_000)).toBe("merchant:apple");
  });

  it("keeps merchant:apple on the monthly plan when the April charge turns into a quarterly plan", () => {
    const after = keys("2026-07-02", [lone, ...monthly, charge("2026-07-01", 2_000)]);
    expect(after.get(1_000)).toBe("merchant:apple");
    expect(after.get(2_000)).toBe("merchant:apple@2000");
  });
});
