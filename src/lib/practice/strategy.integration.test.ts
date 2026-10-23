import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/investments/strategy-today", () => ({ strategyToday: vi.fn() }));

import { AUTOPILOT_LIMITS } from "@/config/portfolios";
import { strategyToday, type StrategyToday } from "@/lib/investments/strategy-today";
import { runAutopilot } from "./autopilot";
import { startPractice } from "./portfolio";
import { practiceProfileOf, savePreferences } from "./preferences";

// The practice autopilot follows its level's chosen strategy (the daily evaluation's) against a
// real, migrated Postgres: it buys the strategy's mix for the month within every hard limit,
// keeps the level's mix when the person's settings change it, and is as before with no choice.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:30:00Z`);
// The trend filter in a falling month at Low: bonds under their average wait in bills.
const TREND: StrategyToday = {
  chosen: {
    level: 2,
    id: "trend",
    params: { months: 6 },
    key: "trend(months=6)",
    label: "Trend filter",
    why: "It beat the level's mix on the later years.",
  } as unknown as StrategyToday["chosen"],
  source: "evaluation",
  follow: true,
  weights: { us_stocks: 0.3, intl_stocks: 0.15, bonds: 0, cash: 0.55 },
  signalDate: "2026-09-01",
};

describe.runIf(url)("the practice autopilot follows its level's strategy", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `practice-strategy-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, 2, { client, now: at("2026-09-01") });
    return user.id;
  };
  const holdings = async (userId: string) => {
    const rows = await client.practicePosition.findMany({ where: { userId } });
    return new Map(rows.map((r) => [r.ticker, r]));
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(() => vi.mocked(strategyToday).mockReset());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("buys the strategy's mix for the month, inside every limit, and says so", async () => {
    vi.mocked(strategyToday).mockResolvedValue(TREND);
    const userId = await person();
    const profile = await practiceProfileOf(userId, { client, now: at("2026-09-01") });
    expect(profile.weights).toEqual(TREND.follow && TREND.weights);
    expect(profile.strategy).toMatchObject({ key: "trend(months=6)", followed: true });
    expect(profile.rules.at(-1)).toMatch(/follows trend filter \(trend\(months=6\)\)/);

    const run = await runAutopilot(userId, { client, now: at("2026-09-01") });
    expect(run.ran && run.fills.length).toBeGreaterThan(0);
    const held = await holdings(userId);
    expect(held.has("BND")).toBe(false);
    const total = 1_000_000 + 50_000;
    expect(held.get("BIL")!.costBasisCents / total).toBeCloseTo(0.55, 2);
    for (const p of held.values())
      expect(p.costBasisCents).toBeLessThanOrEqual(total * AUTOPILOT_LIMITS.perEtfShare);
  });

  it("keeps the level's mix when the person's goal date moves it", async () => {
    vi.mocked(strategyToday).mockResolvedValue(TREND);
    const userId = await person();
    // About four years out: the glide path moves Low toward bonds.
    await savePreferences(userId, { goalDate: "2030-06-01" }, "page", {
      client,
      now: at("2026-09-01"),
    });
    const profile = await practiceProfileOf(userId, { client, now: at("2026-09-01") });
    expect(profile.strategy).toMatchObject({ followed: false });
    expect(profile.weights.bonds).toBeGreaterThan(0);
    await runAutopilot(userId, { client, now: at("2026-09-01") });
    expect((await holdings(userId)).has("BND")).toBe(true);
  });

  it("is as before with no choice yet, or when the strategy can't be followed", async () => {
    vi.mocked(strategyToday).mockResolvedValue(null);
    const plain = await person();
    expect((await practiceProfileOf(plain, { client, now: at("2026-09-01") })).strategy).toBe(
      undefined,
    );
    vi.mocked(strategyToday).mockResolvedValue({
      ...TREND,
      follow: false,
      why: "It holds GLD, which the practice portfolio can't yet.",
    });
    const wide = await practiceProfileOf(plain, { client, now: at("2026-09-01") });
    expect(wide.strategy).toMatchObject({ followed: false });
    expect(wide.rules.at(-1)).toMatch(/GLD/);
    await runAutopilot(plain, { client, now: at("2026-09-01") });
    expect((await holdings(plain)).has("BND")).toBe(true);
  });
});
