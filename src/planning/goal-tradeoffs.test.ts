import { describe, expect, it } from "vitest";
import { fund, tradeoffs, type TradeGoal } from "./goal-tradeoffs";

// Spec step 241, pure: each choice's dates under the year plan's room, a suggested order and why.

const goals: TradeGoal[] = [
  {
    id: "trip",
    name: "The trip",
    leftCents: 300_000,
    wantedMonth: "2027-06",
    monthlyCents: 50_000,
  },
  {
    id: "house",
    name: "The house fund",
    leftCents: 1_200_000,
    wantedMonth: "2027-12",
    monthlyCents: 100_000,
  },
];

describe("fund", () => {
  it("funds the first goal first, up to what it needs a month, then the next", () => {
    const out = fund(goals, ["trip", "house"], [90_000], "2026-11");
    const [trip, house] = out.dates;
    // 50k a month to the trip: 6 months, reached in 2027-04 (month index 5).
    expect(trip.month).toBe("2027-04");
    // The house gets the other 40k a month, then what's left of 90k: slower than wanted.
    expect(house.lateMonths).toBeGreaterThan(0);
  });

  it("puts nothing past what the room allows", () => {
    const out = fund(goals, ["house", "trip"], [60_000], "2026-11");
    // 60k a month: the house takes 60k; the trip gets nothing until the house is done.
    expect(out.dates.find((d) => d.id === "house")!.month).toBe("2028-06");
    expect(out.dates.find((d) => d.id === "trip")!.lateMonths).toBeGreaterThan(12);
  });
});

describe("tradeoffs", () => {
  it("says goals don't compete when there's room for both", () => {
    expect(tradeoffs(goals, [Number.POSITIVE_INFINITY], "2026-11")).toMatchObject({
      competing: false,
    });
    expect(tradeoffs(goals, [200_000], "2026-11")).toMatchObject({ competing: false });
  });

  it("shows each order's dates when they compete, and suggests the one with the least delay", () => {
    const t = tradeoffs(goals, [100_000], "2026-11");
    expect(t.competing).toBe(true);
    expect(t.options).toHaveLength(2);
    expect(t.suggested!.totalLate).toBe(Math.min(...t.options.map((o) => o.totalLate)));
    expect(t.reason).toMatch(/^Putting .+ first leaves the least delay overall: /);
    // The options are in order of least delay first.
    expect(t.options[0].totalLate).toBeLessThanOrEqual(t.options[1].totalLate);
  });

  it("is deterministic and names the slip in months", () => {
    const a = tradeoffs(goals, [100_000], "2026-11");
    const b = tradeoffs([...goals].reverse(), [100_000], "2026-11");
    expect(a.suggested!.order).toEqual(b.suggested!.order);
    expect(a.reason).toMatch(/slips \d+ months|stays on time/);
  });

  it("needs at least two goals", () => {
    expect(tradeoffs([goals[0]], [100_000], "2026-11")).toMatchObject({
      competing: false,
      options: [],
    });
  });
});
