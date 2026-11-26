import { describe, expect, it } from "vitest";
import { matchReceipts } from "./audit-records";

const charge = (id: string, date: string) => ({ id, date, cents: 100 });
const receipt = (id: string, date: string) => ({ id, fileName: `${id}.pdf`, date, cents: 100 });
const pairs = (matched: ReturnType<typeof matchReceipts>) =>
  [...matched].map(([c, r]) => `${c}:${r.id}`).sort();

describe("which receipt stands for which charge", () => {
  // "early" can only be r1; "late" could be either, so it has to leave r1.
  const charges = [charge("late", "2026-03-04"), charge("early", "2026-03-01")];
  const receipts = [receipt("r1", "2026-03-02"), receipt("r2", "2026-03-07")];

  it("gives every charge one where there is one each, in any order", () => {
    for (const c of [charges, [...charges].reverse()]) {
      for (const r of [receipts, [...receipts].reverse()]) {
        expect(pairs(matchReceipts(c, r, 3))).toEqual(["early:r1", "late:r2"]);
      }
    }
  });

  it("calls neither receipted when two charges share one receipt", () => {
    expect(pairs(matchReceipts(charges, [receipts[0]!], 3))).toEqual([]);
  });

  // Both first-of-March charges can only be "a", though three charges and three receipts touch.
  it("sees two charges short of a receipt inside a bigger group", () => {
    const three = [
      charge("one", "2026-03-01"),
      charge("two", "2026-03-01"),
      charge("far", "2026-03-04"),
    ];
    const found = [
      receipt("a", "2026-03-02"),
      receipt("b", "2026-03-06"),
      receipt("c", "2026-03-07"),
    ];
    for (const c of [three, [...three].reverse()]) {
      expect(pairs(matchReceipts(c, found, 3))).toEqual(["far:b"]);
    }
  });
});
