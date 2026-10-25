import { describe, expect, it } from "vitest";
import { CATALOG_CURVE_DATES } from "@/config/catalog-curves";
import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CATALOG_IDS } from "@/config/strategy-catalog";
import {
  BOARD_RANGES,
  LOST_WARNING,
  STATUS_TAGS,
  boardInRange,
  onDates,
  strategyBoard,
  type BoardInput,
} from "./strategy-board";

// The investments page's strategy board: every strategy tested at a level, from the stored
// research, in status order, with the buttons only at the person's own level.

const at = (level: BoardInput["level"], over: Partial<BoardInput> = {}): BoardInput => ({
  level,
  yourLevel: 3,
  choice: "level",
  catalog: null,
  crypto: null,
  dayTrading: null,
  ...over,
});

describe("the board at a level", () => {
  it("lists Jane's pick first, then every catalog strategy tested there, in status order", () => {
    const b = strategyBoard(at(3));
    expect(b.rows[0].key).toBe("default");
    expect(b.rows[0].status).toBe("default");
    const tested = CATALOG_IDS.filter((id) => CATALOG_EVIDENCE[id]?.[3]);
    expect(b.rows).toHaveLength(1 + tested.length);
    const order = ["default", "recommended", "watch", "tested", "lost"];
    const ranks = b.rows.map((r) => order.indexOf(r.status));
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
    for (const r of b.rows) {
      expect(r.values).toHaveLength(CATALOG_CURVE_DATES.length);
      expect(r.line.length).toBeGreaterThan(0);
      expect(r.more.length).toBeGreaterThan(0);
      expect(STATUS_TAGS[r.status]).toBeTruthy();
    }
    // Worth watching is what the research says, and a strategy that lost money says so.
    for (const r of b.rows.filter((x) => x.key.startsWith("catalog:"))) {
      const e = CATALOG_EVIDENCE[r.key.slice(8) as (typeof CATALOG_IDS)[number]]![3]!;
      if (e.cagr < 0 && !e.recommendable) expect(r.status).toBe("lost");
      else if (e.watch) expect(r.status).toBe("watch");
    }
    expect(b.rows.some((r) => r.status === "watch")).toBe(true);
  });

  it("shows crypto and day trading only at Very high, day trading never offered", () => {
    for (const level of [1, 2, 3, 4] as const)
      expect(
        strategyBoard(at(level)).rows.some(
          (r) => r.key.startsWith("crypto:") || r.key.startsWith("intraday:"),
        ),
      ).toBe(false);
    const b = strategyBoard(at(5, { yourLevel: 5 }));
    const day = b.rows.filter((r) => r.key.startsWith("intraday:"));
    expect(day.length).toBeGreaterThan(0);
    for (const r of day) {
      expect(r.status).toBe("lost");
      expect(r.use.kind).toBe("no");
    }
    expect(b.rows.filter((r) => r.key.startsWith("crypto:")).length).toBe(3);
    expect(b.rows.find((r) => r.key === "crypto:crypto_trend")!.use).toEqual({ kind: "yes" });
    expect(b.sources.some((s) => s.startsWith("Day trading:"))).toBe(true);
  });

  it("lets any strategy that runs on its own be used, warning first where it lost money", () => {
    const b = strategyBoard(at(3));
    expect(b.yours).toBe(true);
    for (const r of b.rows.filter((x) => x.key.startsWith("catalog:"))) {
      if (r.key === "catalog:managed_futures") expect(r.use.kind, r.key).toBe("no");
      else if (r.status === "lost")
        expect(r.use, r.key).toEqual({ kind: "confirm", warning: LOST_WARNING });
      else expect(r.use, r.key).toEqual({ kind: "yes" });
    }
    expect(b.rows[0].use).toEqual({ kind: "yes" });
    expect(strategyBoard(at(4)).yours).toBe(false);
  });

  it("highlights what the practice portfolio follows, with the way back", () => {
    const def = strategyBoard(at(3));
    expect(def.highlighted).toBe("default");
    expect(def.rows[0].current).toBe(true);
    const haa = strategyBoard(at(3, { catalog: "haa" }));
    expect(haa.highlighted).toBe("catalog:haa");
    expect(haa.rows.find((r) => r.key === "catalog:haa")!.current).toBe(true);
    expect(haa.rows[0].current).toBe(false);
    const tilt = strategyBoard(at(3, { choice: "value_tilt" }));
    expect(tilt.highlighted).toBe("catalog:value");
    expect(tilt.followsElsewhere).toBeNull();
    const trend = strategyBoard(at(3, { choice: "trend" }));
    expect(trend.highlighted).toBe("default");
    expect(trend.followsElsewhere).toBe("Trend filter");
  });
});

describe("the graph's ranges", () => {
  it("reads a curve of evenly spaced points on the board's dates", () => {
    const v = onDates([100, 200], "2022-01-01", "2022-12-31", [
      "2021-12-31",
      "2022-01-01",
      "2022-07-02",
      "2022-12-31",
    ]);
    expect(v[0]).toBeNull();
    expect(v[1]).toBe(100);
    expect(v[2]).toBeCloseTo(150, 0);
    expect(v[3]).toBe(200);
  });

  it("starts the mix at 100 and each later line from the mix where it begins", () => {
    const board = {
      dates: ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-30", "2023-12-29"],
      mix: { label: "", values: [100, 110, 121, 100, 120], cagr: 0, maxDrawdown: 0, sortino: 0 },
      rows: [
        { key: "a", values: [100, 120, 130, 110, 140] },
        { key: "late", values: [null, null, 100, 90, 99] },
      ] as never,
    };
    const all = boardInRange(board, "2020");
    expect(all.dates).toHaveLength(5);
    expect(all.mix[0]).toBe(100);
    expect(all.lines.a[0]).toBe(100);
    // Starts with the mix at 121: $100 then reads as the mix's $121.
    expect(all.lines.late).toEqual([null, null, 121, 108.9, 119.8]);
    const later = boardInRange(board, "2022");
    expect(later.dates[0]).toBe("2021-12-31");
    expect(later.mix).toEqual([100, 82.6, 99.2]);
    expect(later.lines.late[0]).toBe(100);
    expect(later.lines.a).toEqual([100, 84.6, 107.7]);
  });

  it("has a past-year range a year back from the last date", () => {
    const b = strategyBoard(at(3));
    const year = boardInRange(b, "1y");
    expect(year.dates.length).toBeGreaterThanOrEqual(12);
    expect(year.dates.length).toBeLessThanOrEqual(14);
    expect(year.mix[0]).toBe(100);
    expect(BOARD_RANGES.map((r) => r.key)).toEqual(["2020", "2022", "1y"]);
  });
});
