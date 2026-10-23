import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));

import { PRACTICE_ETFS, PRACTICE_UNIVERSE, strategyTickers } from "@/config/portfolios";
import { OPPORTUNITY_RULES_OFF } from "@/config/practice-scan";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { historyTickers } from "@/lib/market/history";
import { SampleMarketData } from "@/lib/market/sample";
import { loadRuleReplays, ruleReplaysFor } from "./rule-replay";

// "Did the extra rules help?": stored real history when the model backtests use it (with
// whatever else is stored), else the sample market; each rule's verdict; demo advice only; never
// a live call.

const NOW = new Date("2026-10-21T15:00:00Z");
const MAIN = Object.values(PRACTICE_ETFS).map((e) => e.ticker as string);

type Row = { ticker: string; date: Date; closeCents: number; source: string };

function fakeClient(rows: Row[]) {
  const findMany = vi.fn(
    async ({ where }: { where: { ticker: string; date: { gte: Date; lte: Date } } }) =>
      rows
        .filter(
          (r) => r.ticker === where.ticker && r.date >= where.date.gte && r.date <= where.date.lte,
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
  );
  const news = vi.fn(async () => []);
  const client = {
    marketPrice: { findMany },
    marketNews: { findMany: news },
  } as unknown as PrismaClient;
  return { client, findMany, news };
}

// "Real" stored closes: the sample's own prices, relabelled as Alpaca's.
async function storedRows(tickers: readonly string[], from: string): Promise<Row[]> {
  const sample = new SampleMarketData();
  const out: Row[] = [];
  for (const ticker of tickers)
    for (const b of await sample.prices(ticker, from, "2026-10-21"))
      out.push({
        ticker,
        date: new Date(`${b.date}T00:00:00Z`),
        closeCents: b.closeCents,
        source: "alpaca",
      });
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("loadRuleReplays", () => {
  it("replays the sample market when nothing is stored, says so, and never calls out", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { client } = fakeClient([]);
    const data = (await loadRuleReplays({ client, now: NOW }, [1, 4]))!;
    expect(fetch).not.toHaveBeenCalled();
    expect(data.source).toBe("sample");
    expect(data.label).toBe("Replay of sample history since Jan 2, 2018");
    expect(data.notes.join(" ")).toMatch(/made-up prices/i);
    expect(data.replays.notAForecast).toMatch(/not a forecast/);
    expect(data.replays.to <= "2026-10-21").toBe(true);
    expect(data.replays.missing).toEqual([]);
    expect(data.replays.levels.map((l) => l.label)).toEqual(["Very low", "High"]);
    for (const l of data.replays.levels) {
      expect(Object.keys(l.strategies)).toEqual(["rules", "rebalance", "hold"]);
      expect(l.strategies.hold.trades).toBeGreaterThan(0);
      expect(l.strategies.rules.stress.map((s) => s.label)).toEqual(["2020", "2022"]);
      expect(l.strategies.rules.stress.every((s) => s.fraction !== null && s.fraction < 0)).toBe(
        true,
      );
    }
    const [veryLow, high] = data.replays.levels;
    const verdict = (l: typeof high, rule: string) => l.verdicts.find((v) => v.rule === rule)!;
    expect(verdict(veryLow, "news_idea").status).toBe("not_at_level");
    expect(verdict(high, "news_idea").status).not.toBe("not_at_level");
    // Turned off from the real-history replay: said so, with the evidence.
    const off = OPPORTUNITY_RULES_OFF[4]!.find((r) => r.rule === "tax_loss_harvest")!;
    expect(verdict(high, "tax_loss_harvest")).toMatchObject({ status: "off" });
    expect(verdict(high, "tax_loss_harvest").why).toContain(off.evidence);
    expect(verdict(high, "tax_loss_harvest").returnPoints).not.toBeNull();
  });

  it("uses stored real history, and says which rules it couldn't replay", async () => {
    // Only the four model funds are stored, from 2020: no swap partners, stocks or headlines.
    const { client, news } = fakeClient(await storedRows(MAIN, "2020-01-02"));
    const data = (await loadRuleReplays({ client, now: NOW }, [4]))!;
    expect(data.source).toBe("real");
    expect(data.label).toBe("Replay of real history since Jan 2, 2020");
    expect(news).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ feed: "alpaca" }) }),
    );
    expect(data.replays.missing).toEqual(
      [...PRACTICE_UNIVERSE].filter((t) => !MAIN.includes(t)).sort(),
    );
    const verdicts = Object.fromEntries(data.replays.levels[0].verdicts.map((v) => [v.rule, v]));
    expect(verdicts.tax_loss_harvest.status).toBe("not_replayed");
    expect(verdicts.tax_loss_harvest.why).toMatch(/no history for ITOT, IXUS, AGG/);
    expect(verdicts.news_idea.status).toBe("not_replayed");
    expect(verdicts.dip_buy.status).not.toBe("not_replayed");
    // 2020 is covered from its first day; nothing before it.
    expect(data.replays.levels[0].strategies.rules.stress[0].fraction).not.toBeNull();
  });

  it("replays news ideas only when headlines are stored for the dates", async () => {
    const { client } = fakeClient(await storedRows([...PRACTICE_UNIVERSE], "2025-01-02"));
    const data = (await loadRuleReplays({ client, now: NOW }, [5]))!;
    const news = data.replays.levels[0].verdicts.find((v) => v.rule === "news_idea")!;
    expect(news).toMatchObject({ status: "not_replayed" });
    expect(news.why).toMatch(/no headlines stored/);
    expect(data.replays.missing).toEqual([]);
    // 2020 isn't in a replay from 2025.
    expect(data.replays.levels[0].strategies.rules.stress[0].fraction).toBeNull();
  });
});

describe("ruleReplaysFor", () => {
  it("gives nothing without demo advice mode", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    const { client, findMany } = fakeClient([]);
    expect(await ruleReplaysFor("u1", { client, now: NOW })).toEqual({ advice: false });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("gives the replays in demo advice mode", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    const { client } = fakeClient([]);
    const out = await ruleReplaysFor("u1", { client, now: NOW }, [2]);
    expect(out.advice && out.data?.replays.levels[0].label).toBe("Low");
  });
});

describe("the daily history load", () => {
  it("stores every practice and strategy ticker, the model funds first, each once", () => {
    const tickers = historyTickers();
    expect(tickers.slice(0, 4)).toEqual(MAIN);
    const all = new Set([...PRACTICE_UNIVERSE, ...strategyTickers()]);
    expect(new Set(tickers)).toEqual(all);
    expect(tickers).toHaveLength(all.size);
    for (const t of ["VBR", "VEA", "VWO", "VNQ", "SHY", "IEF", "TLT", "TIP", "GLD"])
      expect(tickers).toContain(t);
  });
});
