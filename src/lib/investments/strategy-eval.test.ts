import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { strategyTickers } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { runStrategyEvaluation } from "./strategy-eval";

// The weekly strategy evaluation on stored closes: the fixture stands in for the Alpaca rows in
// market_prices. It saves each level's choice with its numbers, and runs nothing without enough
// history. No call out.

const NOW = new Date("2026-10-22T11:00:00Z");
type Row = { ticker: string; date: Date; closeCents: number; source: string };

function fakeClient(rows: Row[]) {
  const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: "eval-1" }));
  const findMany = vi.fn(
    async ({ where }: { where: { ticker: string; date: { gte: Date; lte: Date } } }) =>
      rows.filter(
        (r) => r.ticker === where.ticker && r.date >= where.date.gte && r.date <= where.date.lte,
      ),
  );
  return {
    client: {
      marketPrice: { findMany },
      strategyEvaluation: { create },
    } as unknown as PrismaClient,
    create,
  };
}

function storedRows(from = "2016-01-01", skip: string | null = null): Row[] {
  const bars = realFixtureBars();
  return strategyTickers()
    .filter((t) => t !== skip)
    .flatMap((ticker) =>
      bars[ticker]
        .filter((b) => b.date >= from)
        .map((b) => ({
          ticker,
          date: new Date(`${b.date}T00:00:00Z`),
          closeCents: b.closeCents,
          source: "alpaca",
        })),
    );
}

afterEach(() => vi.unstubAllGlobals());

describe("runStrategyEvaluation", () => {
  it(
    "chooses and saves each level's strategy from the stored closes, calling nothing out",
    { timeout: 120_000 },
    async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const { client, create } = fakeClient(storedRows());
      const run = await runStrategyEvaluation({ client, now: NOW });
      expect(fetch).not.toHaveBeenCalled();
      expect(run.ran).toBe(true);
      if (!run.ran) return;
      expect(run.from).toBe("2016-01-04");
      expect(run.to).toBe("2026-10-21");
      expect(run.chosen.map((c) => [c.level, c.key])).toEqual([
        [1, "trend(months=6)"],
        [2, "trend(months=6)"],
        [3, "trend(months=6)"],
        [4, "trend(months=6)"],
        [5, "static(rebalance=band)"],
      ]);
      expect(run.chosen[0].label).toBe("Trend filter");
      expect(run.chosen[0].why).toMatch(/beat the level's mix on the later years/);
      const saved = create.mock.calls[0][0].data as {
        source: string;
        chosen: unknown[];
        results: { level: number; byStartYear: { results: unknown[] }[] }[];
      };
      expect(saved.source).toBe("alpaca");
      expect(saved.chosen).toHaveLength(5);
      expect(saved.results[0].byStartYear).toHaveLength(3);
      expect(saved.results[0].byStartYear[0].results.length).toBeGreaterThan(15);
    },
  );

  it("runs nothing while a fund has no stored closes, or the history is too short", async () => {
    const missing = fakeClient(storedRows("2016-01-01", "GLD"));
    expect(await runStrategyEvaluation({ client: missing.client, now: NOW })).toEqual({
      ran: false,
      why: "Not every strategy fund has stored closes yet.",
    });
    const short = fakeClient(storedRows("2025-01-01"));
    const run = await runStrategyEvaluation({ client: short.client, now: NOW });
    expect(run.ran).toBe(false);
    expect(!run.ran && run.why).toMatch(/needs 756/);
    expect(missing.create).not.toHaveBeenCalled();
    expect(short.create).not.toHaveBeenCalled();
  });
});
