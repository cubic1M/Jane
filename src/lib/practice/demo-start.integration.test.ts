import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DEMO_PRACTICE_REPLAY_DAYS } from "@/config/portfolios";
import { logAudit } from "@/lib/audit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { ensureDemoPractice, replayDays } from "./demo-start";

// A sample person's practice portfolio starts by itself (Phase AW, Stage A), against a real,
// migrated Postgres and the sample market: a few weeks back, at their level, with every trading
// day since run as the daily practice run does, so there are trades to see. Once only, and
// never for a real person.

const url = process.env.TEST_DATABASE_URL;
const now = new Date("2026-10-23T14:00:00Z");

describe("replayDays", () => {
  it("is the weekdays from the start to before today", () => {
    expect(replayDays("2026-10-16", "2026-10-23")).toEqual([
      "2026-10-16",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
  });
});

describe.runIf(url)("a sample person's practice portfolio starts by itself", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `demo-practice-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    // The sample market, never a live service.
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts weeks back, replays each trading day and keeps the trades, once", async () => {
    const userId = await person();
    await linkDemoBank(userId, { client, now });
    const out = await ensureDemoPractice(userId, { client, now });
    expect(out).toMatchObject({ started: true, level: 3 });
    if (!out.started) return;
    expect(out.days).toBeGreaterThanOrEqual(15);
    expect(out.trades).toBeGreaterThan(0);

    const portfolio = await client.practicePortfolio.findFirstOrThrow({ where: { userId } });
    const back = (now.getTime() - portfolio.startedAt.getTime()) / 86_400_000;
    expect(back).toBeGreaterThan(DEMO_PRACTICE_REPLAY_DAYS - 4);
    expect(back).toBeLessThanOrEqual(DEMO_PRACTICE_REPLAY_DAYS);
    const trades = await client.practiceTrade.findMany({
      where: { userId, side: { in: ["buy", "sell"] } },
      orderBy: { placedAt: "asc" },
    });
    expect(trades[0].rule).toBe("model_buy");
    expect(trades.every((t) => t.placedAt < now)).toBe(true);
    // Each day ran as the daily run does: the monthly money went in on its day and was invested.
    const deposits = await client.practiceTrade.findMany({
      where: { userId, rule: "monthly_add" },
    });
    expect(deposits.length).toBeGreaterThan(0);
    expect(new Set(trades.map((t) => t.placedAt.toISOString().slice(0, 10))).size).toBeGreaterThan(
      1,
    );
    // Started by Jane, said so in the audit log.
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "practice_started",
      expect.anything(),
      expect.objectContaining({ auto: "true" }),
    );

    expect(await ensureDemoPractice(userId, { client, now })).toEqual({
      started: false,
      why: "exists",
    });
    expect(await client.practicePortfolio.count({ where: { userId } })).toBe(1);
  });

  it("leaves a real person to start their own", async () => {
    const userId = await person();
    expect(await ensureDemoPractice(userId, { client, now })).toEqual({
      started: false,
      why: "not_demo",
    });
    expect(await client.practicePortfolio.count({ where: { userId } })).toBe(0);
  });
});
