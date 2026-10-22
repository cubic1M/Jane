import { describe, expect, it } from "vitest";
import {
  fund,
  monthLabel,
  orderGoals,
  parseGoalOrder,
  roomFromPlan,
  tradeGoalOf,
  tradeoffs,
  type TradeGoal,
} from "./goal-tradeoffs";

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

describe("the year plan's room, goals and the person's pick", () => {
  it("takes the margin less dated payments and extra debt payments, from this month on", () => {
    const month = (m: string, margin: number, fixed: number, debt: number) => ({
      month: m,
      marginCents: margin,
      targets: { insurance: fixed, taxes: 0, deadlines: 0, debt },
    });
    expect(
      roomFromPlan(
        [month("2026-09", 100_000, 0, 0), month("2026-10", 100_000, 20_000, 10_000)],
        "2026-10",
      ),
    ).toEqual([70_000]);
    expect(roomFromPlan([month("2026-10", 10_000, 30_000, 0)], "2026-10")).toEqual([0]);
    expect(roomFromPlan([], "2026-10")).toEqual([0]);
  });

  it("only trades off goals still on the way", () => {
    const base = { id: "g", name: "Trip", targetDate: "2027-06-01" };
    expect(
      tradeGoalOf({
        ...base,
        progress: { status: "on_the_way", leftCents: 5_000, monthlyCents: 700 },
      }),
    ).toEqual({
      id: "g",
      name: "Trip",
      leftCents: 5_000,
      wantedMonth: "2027-06",
      monthlyCents: 700,
    });
    expect(tradeGoalOf({ ...base, progress: { status: "reached" } })).toBeNull();
    expect(tradeGoalOf({ ...base, progress: { status: "date_passed" } })).toBeNull();
  });

  it("puts goals in the picked order, the rest after in their own order", () => {
    const goals = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(orderGoals(goals, ["c", "a"]).map((g) => g.id)).toEqual(["c", "a", "b"]);
    expect(orderGoals(goals, null).map((g) => g.id)).toEqual(["a", "b", "c"]);
    expect(parseGoalOrder("c,a")).toEqual(["c", "a"]);
    expect(parseGoalOrder(["c"])).toBeNull();
    expect(parseGoalOrder("")).toBeNull();
  });

  it("names months the way people say them", () => {
    expect(monthLabel("2027-06")).toBe("June 2027");
  });
});

describe("with no room at all", () => {
  it("says there's nothing to weigh yet and keeps the goals in date order", () => {
    const view = tradeoffs(goals, [0], "2026-11");
    expect(view.competing).toBe(true);
    expect(view.options).toHaveLength(1);
    expect(view.suggested?.order).toEqual(["trip", "house"]);
    expect(view.reason).toMatch(/^Your plan has no room for goals right now/);
  });
});
