import { describe, expect, it } from "vitest";
import { reliableDays } from "./debt-decisions";

// CodeRabbit sweep 1c (lib-01): an overdraft signal reads only the forecast's reliable days.
describe("the forecast days an overdraft signal may read", () => {
  const days = [
    { date: "2026-11-20", balanceCents: 40_000 },
    { date: "2026-11-24", balanceCents: 10_000 },
    { date: "2026-11-28", balanceCents: -5_000 },
  ];
  const firstNegative = (d: typeof days) => d.find((x) => x.balanceCents < 0) ?? null;

  it("leaves out a negative day after the next likely uneven payday", () => {
    expect(firstNegative(reliableDays(days, "2026-11-26"))).toBeNull();
  });
  it("keeps a negative day before it", () => {
    expect(firstNegative(reliableDays(days, "2026-11-30"))?.date).toBe("2026-11-28");
  });
  it("keeps every day when there is no such day, or none is before it", () => {
    expect(reliableDays(days, null)).toHaveLength(3);
    expect(reliableDays(days, "2026-11-01")).toHaveLength(3);
  });
});
