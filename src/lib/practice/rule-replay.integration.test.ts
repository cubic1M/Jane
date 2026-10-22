import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { RiskLevel } from "@/config/investing";
import {
  PRACTICE_MONTHLY_ADD_CENTS,
  PRACTICE_START_CENTS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
} from "@/config/portfolios";
import { rulesOnAt } from "@/config/practice-scan";
import { SAMPLE_START, SampleMarketData } from "@/lib/market/sample";
import type { Bar } from "@/lib/market/types";
import { replayRules } from "@/planning/rule-replay";
import { startPractice } from "./portfolio";
import { runPracticeDay } from "./scan";

// The rule replay and the live daily run are the same code: the live cron's day
// (runPracticeDay: the monthly money, the scan acting through the paper broker, the autopilot)
// against a real, migrated Postgres, and the replay over the same sample days, make the same
// trades on the same days for the same amounts and rules, and act on the same flags.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:30:00Z`);
const market = new SampleMarketData();
const FROM = "2026-09-01";
const TO = "2026-10-30";

describe.runIf(url)("the rule replay against the live daily run", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  // Low harvests in this autumn's dip; Very high brings news ideas. (Run daily, the month's money
  // is invested on the 1st, so no cash is waiting for the dip on Oct 14: the hand-worked case in
  // src/planning/rule-replay.test.ts has the dip buy.)
  it.each([2, 5] as const)("makes the live run's trades at level %i", async (level: RiskLevel) => {
    const bars: Record<string, Bar[]> = {};
    for (const t of PRACTICE_UNIVERSE) bars[t] = await market.prices(t, SAMPLE_START, TO);
    const replay = replayRules({
      level,
      bars,
      from: FROM,
      headlines: await market.news(PRACTICE_STOCKS, SAMPLE_START, TO),
      startCents: PRACTICE_START_CENTS,
      monthlyAddCents: PRACTICE_MONTHLY_ADD_CENTS,
      addDay: 1,
      strategy: "rules",
      rules: rulesOnAt(level),
      tradeCostBps: 0,
    })!;
    const days = [...new Set(replay.index.map((p) => p.date))];

    const user = await client.user.create({
      data: { email: `rule-replay-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, level, { client, now: at(days[0]) });
    for (const day of days) await runPracticeDay(user.id, { client, now: at(day) });

    const live = await client.practiceTrade.findMany({
      where: { userId: user.id, side: { in: ["buy", "sell"] } },
      select: { placedAt: true, ticker: true, side: true, amountCents: true, rule: true },
    });
    const key = (t: {
      date: string;
      ticker: string;
      side: string;
      amountCents: number;
      rule: string;
    }) => `${t.date} ${t.side} ${t.ticker} ${t.amountCents} ${t.rule}`;
    const liveKeys = live
      .map((t) => key({ ...t, ticker: t.ticker!, date: t.placedAt.toISOString().slice(0, 10) }))
      .sort();
    const replayKeys = replay.trades.map(key).sort();
    expect(replayKeys.length).toBeGreaterThan(5);
    expect(replayKeys).toEqual(liveKeys);

    // The same flags acted on.
    const acted = await client.practiceOpportunity.groupBy({
      by: ["kind"],
      where: { userId: user.id, status: "acted" },
      _count: true,
    });
    expect(Object.fromEntries(acted.map((a) => [a.kind, a._count]))).toEqual(replay.acted);
    if (level === 5) expect(Object.keys(replay.acted)).toContain("news_idea");
    if (level === 2) expect(Object.keys(replay.acted)).toContain("tax_loss_harvest");

    // And the same portfolio at the end.
    const portfolio = await client.practicePortfolio.findFirstOrThrow({
      where: { userId: user.id },
    });
    const deposits = await client.practiceTrade.aggregate({
      where: { userId: user.id, side: "deposit" },
      _sum: { amountCents: true },
    });
    expect(deposits._sum.amountCents).toBe(replay.putInCents);
    const spent = replay.trades.reduce(
      (s, t) => s + (t.side === "buy" ? -t.amountCents : t.amountCents),
      0,
    );
    expect(portfolio.cashCents).toBe(replay.putInCents + spent);
  });
});
