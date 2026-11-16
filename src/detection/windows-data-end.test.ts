import { describe, expect, it } from "vitest";
import { cashCushionOf, type IdleTx } from "@/planning/idle-cash";
import { inLookback } from "./helpers";
import type { DetectionInput } from "./types";

// Gate C's calendar sweep (src/sweep/), 11-15: detection's twelve months, and idle cash's, ended
// at today. For statements that stopped weeks ago the first day fell out each day they sat: "10
// interest charges in 12 months" became 9, and the cash cushion moved daily with nothing new. Once
// data is old (statementsEnd) the months end where it reaches, so two days later nothing moves.

// Groceries on the 2nd of each month, and one more on Dec 11 2025; the statements end Oct 24 2026.
const DAYS = [
  ...Array.from({ length: 11 }, (_, i) =>
    new Date(Date.UTC(2025, 11 + i, 2)).toISOString().slice(0, 10),
  ),
  "2025-12-11",
  "2026-10-24",
].sort();
const TXS: IdleTx[] = DAYS.map((date) => ({
  date,
  amountCents: 60_000,
  accountId: "checking",
  pfc: "FOOD_AND_DRINK_GROCERIES",
}));

describe("windows over data that has stopped", () => {
  it("keeps the same twelve months on Dec 12 as on Dec 10", () => {
    const at = (asOf: string) =>
      inLookback({ asOf, transactions: TXS } as unknown as DetectionInput).map((t) => t.date);
    expect(at("2026-12-10")).toContain("2025-12-11");
    expect(at("2026-12-12")).toEqual(at("2026-12-10"));
  });

  it("measures the same cash cushion on Dec 12 as on Dec 10", () => {
    const cushion = (asOf: string) =>
      cashCushionOf({
        asOf,
        accounts: [
          { id: "checking", type: "depository", subtype: "checking", balanceCents: 4_000_000 },
        ],
        transactions: TXS,
      });
    expect(cushion("2026-12-10")).not.toBeNull();
    expect(cushion("2026-12-12")).toEqual(cushion("2026-12-10"));
  });

  it("still ends at today while the data is current", () => {
    const at = (asOf: string) =>
      inLookback({ asOf, transactions: TXS } as unknown as DetectionInput).map((t) => t.date);
    // Nov 10: the newest line (Oct 24) is 17 days old, so the year is the one before Nov 10.
    expect(at("2026-11-10")).toEqual(DAYS.filter((d) => d > "2025-11-10"));
  });
});
