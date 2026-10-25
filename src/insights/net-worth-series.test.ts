import { describe, expect, it } from "vitest";
import { changeOver, dailyNetWorth, pointsIn, rangesFor } from "./net-worth-series";

// The home hub's net worth chart: every day from the first day with Jane to today, ending at
// the headline figure.

const accounts = [
  { id: "chk", type: "depository", currentBalanceCents: 300_000 },
  { id: "card", type: "credit", currentBalanceCents: 50_000 },
];

describe("daily net worth", () => {
  it("counts each account at its last balance, carried over gaps, and ends at today's figure", () => {
    const points = dailyNetWorth({
      accounts,
      snapshots: [
        { accountId: "chk", date: "2026-10-01", balanceCents: 100_000 },
        { accountId: "chk", date: "2026-10-03", balanceCents: 200_000 },
        { accountId: "card", date: "2026-10-01", balanceCents: 20_000 },
      ],
      owned: [],
      firstDay: "2026-10-01",
      asOf: "2026-10-05",
      todayCents: 250_000,
    });
    expect(points.map((p) => p.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(points.map((p) => p.cents)).toEqual([80_000, 80_000, 180_000, 180_000, 250_000]);
  });

  it("counts things owned, crypto and accounts with no history at today's value throughout", () => {
    const points = dailyNetWorth({
      accounts: [...accounts, { id: "inv", type: "investment", currentBalanceCents: 1_000_000 }],
      snapshots: [
        { accountId: "chk", date: "2026-10-01", balanceCents: 100_000 },
        { accountId: "card", date: "2026-10-01", balanceCents: 0 },
      ],
      owned: [{ id: "home", valueCents: 40_000_000, valuedOn: "2026-10-03" }],
      cryptoCents: 5_000,
      firstDay: "2026-10-01",
      asOf: "2026-10-03",
      todayCents: 41_000_000,
    });
    // 100_000 + home 40M + crypto 5k + investments 1M, the same every day until today.
    expect(points[0].cents).toBe(41_105_000);
    expect(points[1].cents).toBe(41_105_000);
    expect(points[2].cents).toBe(41_000_000);
  });

  it("counts an account at its first balance before it has one, so a new link isn't a jump", () => {
    const points = dailyNetWorth({
      accounts,
      snapshots: [
        { accountId: "chk", date: "2026-10-01", balanceCents: 100_000 },
        { accountId: "card", date: "2026-10-03", balanceCents: 30_000 },
      ],
      owned: [],
      firstDay: "2026-10-01",
      asOf: "2026-10-04",
      todayCents: 70_000,
    });
    expect(points.slice(0, 3).map((p) => p.cents)).toEqual([70_000, 70_000, 70_000]);
  });

  it("is one point, today, when the first day is today", () => {
    const points = dailyNetWorth({
      accounts,
      snapshots: [],
      owned: [],
      firstDay: "2026-10-23",
      asOf: "2026-10-23",
      todayCents: 250_000,
    });
    expect(points).toEqual([{ date: "2026-10-23", cents: 250_000 }]);
  });
});

describe("ranges", () => {
  const line = (days: number) =>
    Array.from({ length: days + 1 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      cents: 1_000 * i,
    }));

  it("offer only the ranges the history is longer than, and ALL last", () => {
    expect(rangesFor(line(0))).toEqual(["ALL"]);
    expect(rangesFor(line(10))).toEqual(["1W", "ALL"]);
    expect(rangesFor(line(100))).toEqual(["1W", "1M", "3M", "ALL"]);
    expect(rangesFor(line(400))).toEqual(["1W", "1M", "3M", "1Y", "ALL"]);
  });

  it("take that many days back from today", () => {
    const all = line(100);
    expect(pointsIn(all, "1W")).toHaveLength(8);
    expect(pointsIn(all, "1W")[0].date).toBe(all[93].date);
    expect(pointsIn(all, "ALL")).toHaveLength(101);
  });

  it("measure the change from the range's start, to today or to a scrubbed point", () => {
    const pts = [
      { date: "a", cents: 100_000 },
      { date: "b", cents: 90_000 },
      { date: "c", cents: 150_000 },
    ];
    expect(changeOver(pts)).toEqual({ cents: 50_000, share: 0.5 });
    expect(changeOver(pts, 1)).toEqual({ cents: -10_000, share: -0.1 });
    expect(
      changeOver([
        { date: "a", cents: 0 },
        { date: "b", cents: 10 },
      ]),
    ).toEqual({
      cents: 10,
      share: null,
    });
    // From a start below zero or of a few dollars, a percentage is alarming and means nothing
    // (QA: "−$7,344 (−487.4%)"): only the dollars.
    expect(
      changeOver([
        { date: "a", cents: -150_000 },
        { date: "b", cents: -885_100 },
      ]),
    ).toEqual({ cents: -735_100, share: null });
    expect(
      changeOver([
        { date: "a", cents: 50_000 },
        { date: "b", cents: 90_000 },
      ]).share,
    ).toBeNull();
  });
});
