import { describe, expect, it } from "vitest";
import { checkBudget, describeRow } from "./perf-budget";

const stats = [
  { route: "/home", firstLoadUncompressedJsBytes: 570_000 },
  { route: "/money", firstLoadUncompressedJsBytes: 517_000 },
  { route: "/other", firstLoadUncompressedJsBytes: 900_000 },
];

describe("checkBudget", () => {
  it("passes a page at or under its number", () => {
    const rows = checkBudget(stats, { "/home": 570_000, "/money": 600_000 });
    expect(rows.map((r) => r.ok)).toEqual([true, true]);
  });

  it("fails a page over its number and says by how much", () => {
    const [row] = checkBudget(stats, { "/home": 560_000 });
    expect(row.ok).toBe(false);
    expect(describeRow(row)).toBe("FAIL  /home: 556.6 kB of 546.9 kB (9.8 kB over)");
  });

  it("fails a budgeted page that is not in the build", () => {
    const [row] = checkBudget(stats, { "/gone": 500_000 });
    expect(row).toEqual({ route: "/gone", bytes: null, budget: 500_000, ok: false });
    expect(describeRow(row)).toBe("FAIL  /gone: not in the build (budget 488.3 kB)");
  });

  it("ignores pages that have no budget", () => {
    expect(checkBudget(stats, { "/money": 600_000 })).toHaveLength(1);
  });
});
