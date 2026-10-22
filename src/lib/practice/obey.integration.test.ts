import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// Practice ideas are for demo advice mode only (a real account gets the rebalance alone).
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { classOf } from "@/config/portfolios";
import { TICKER_TAGS } from "@/config/practice-preferences";
import { runAutopilot } from "./autopilot";
import { addPracticeMoney, startPractice } from "./portfolio";
import { savePreferences } from "./preferences";
import { runPracticeDay, scanPractice } from "./scan";

// The autopilot and the daily scan obey the person's preferences, against a real Postgres and
// the sample market's planted events (the October dip on the 14th, NVDA news on the 9th):
// suggest only places nothing, exclusions are never bought, the appetite and loss harvesting
// switch extra moves off, the cash buffer is kept and a near goal date moves the mix to safety.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:00:00Z`);

describe.runIf(url)("the practice autopilot obeys preferences", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (
    level: 1 | 2 | 3 | 4 | 5,
    prefs: Parameters<typeof savePreferences>[1] = {},
    buyFirst = true,
  ) => {
    const user = await client.user.create({
      data: { email: `practice-obey-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, level, { client, now: at("2026-09-01") });
    if (buyFirst) await runAutopilot(user.id, { client, now: at("2026-09-01") });
    const r = await savePreferences(user.id, prefs, "page", { client, now: at("2026-09-01") });
    expect(r.ok).toBe(true);
    return user.id;
  };
  const tradesSince = (userId: string, day: string) =>
    client.practiceTrade.findMany({
      where: { userId, side: { in: ["buy", "sell"] }, placedAt: { gte: at(day) } },
    });
  const valueOf = async (userId: string, kind: "stocks" | "safe", day: string) => {
    const rows = await client.practicePosition.findMany({ where: { userId } });
    const { marketData } = await import("@/lib/market");
    // Uninvested practice cash is safe too.
    let sum =
      kind === "safe"
        ? (await client.practicePortfolio.findUniqueOrThrow({ where: { userId } })).cashCents
        : 0;
    for (const r of rows) {
      const c = classOf(r.ticker);
      const isStocks = c === "us_stocks" || c === "intl_stocks" || c === null;
      if ((kind === "stocks") !== isStocks) continue;
      const bar = await marketData().latest(r.ticker, day);
      sum += r.quantity * (bar?.closeCents ?? 0);
    }
    return sum;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("suggest only places no practice trades, and says what it would have done", async () => {
    const fresh = await person(4, { mode: "suggest" }, false);
    const first = await runAutopilot(fresh, { client, now: at("2026-09-01") });
    expect(first.ran && first.fills).toEqual([]);
    expect(first.ran && first.suggested.length).toBeGreaterThan(0);
    expect(await tradesSince(fresh, "2026-09-01")).toEqual([]);

    const userId = await person(4, { mode: "suggest" });
    const day = await runPracticeDay(userId, { client, now: at("2026-10-14") });
    expect(await tradesSince(userId, "2026-10-14")).toEqual([]);
    const flags = day?.scan.scanned ? day.scan.flags : [];
    expect(flags.some((f) => f.status === "suggested")).toBe(true);
    expect(flags.every((f) => f.status !== "acted" && f.trades === 0)).toBe(true);

    // Switched to act, an idea already suggested isn't placed again by the scan (the person's
    // Yes on its suggestion places it), and nothing is offered twice.
    await savePreferences(userId, { mode: "act" }, "chat", { client, now: at("2026-10-14") });
    const again = await scanPractice(userId, { client, now: at("2026-10-14") });
    const suggestedKinds = new Set(
      flags.filter((f) => f.status === "suggested").map((f) => f.kind),
    );
    const repeated = again.scanned
      ? again.flags.filter((f) => f.kind !== "drift_rebalance" && suggestedKinds.has(f.kind))
      : [];
    expect(
      repeated.filter(
        (f) => f.ticker && flags.some((g) => g.ticker === f.ticker && g.kind === f.kind),
      ),
    ).toEqual([]);

    // A fresh portfolio in act mode acts on the same planted dip.
    const actor = await person(4);
    const acted = await scanPractice(actor, { client, now: at("2026-10-14") });
    expect(acted.scanned && acted.flags.some((f) => f.status === "acted")).toBe(true);
  });

  it("never buys anything on the never-buy list", async () => {
    // ITOT is VTI's harvest partner; tech covers every news company.
    const userId = await person(5, { avoid: ["ITOT", "IXUS", "tech"] });
    await addPracticeMoney(userId, 50_000, "Practice money for the test.", "test", {
      client,
      now: at("2026-10-08"),
    });
    await runPracticeDay(userId, { client, now: at("2026-10-09") });
    await runPracticeDay(userId, { client, now: at("2026-10-14") });
    await runPracticeDay(userId, { client, now: at("2026-10-15") });
    const buys = (await tradesSince(userId, "2026-09-01")).filter((t) => t.side === "buy");
    expect(buys.length).toBeGreaterThan(0);
    const banned = new Set(["ITOT", "IXUS", ...Object.keys(TICKER_TAGS)]);
    expect(buys.filter((t) => banned.has(t.ticker!))).toEqual([]);
  });

  it("with extra moves off, buys no dips and takes no ideas; with harvesting off, harvests nothing", async () => {
    const userId = await person(5, { appetite: "off", harvestLosses: false });
    await addPracticeMoney(userId, 50_000, "Practice money for the test.", "test", {
      client,
      now: at("2026-10-08"),
    });
    const news = await scanPractice(userId, { client, now: at("2026-10-09") });
    const dip = await runPracticeDay(userId, { client, now: at("2026-10-14") });
    const kinds = [
      ...(news.scanned ? news.flags : []),
      ...(dip?.scan.scanned ? dip.scan.flags : []),
    ].map((f) => f.kind);
    expect(kinds).not.toContain("news_idea");
    expect(kinds).not.toContain("dip_buy");
    expect(kinds).not.toContain("tax_loss_harvest");
  });

  it("keeps the cash buffer", async () => {
    const userId = await person(4, { cashBufferCents: 200_000 });
    await runPracticeDay(userId, { client, now: at("2026-10-14") });
    await runPracticeDay(userId, { client, now: at("2026-10-15") });
    const row = await client.practicePortfolio.findUniqueOrThrow({ where: { userId } });
    expect(row.cashCents).toBeGreaterThanOrEqual(200_000);
    const sales = await tradesSince(userId, "2026-09-01");
    expect(sales.some((t) => t.rule === "cash_buffer")).toBe(true);
  });

  it("moves toward bonds and cash when the goal date is near", async () => {
    const userId = await person(5);
    const stocksBefore = await valueOf(userId, "stocks", "2026-10-15");
    const safeBefore = await valueOf(userId, "safe", "2026-10-15");
    await savePreferences(userId, { goal: "home", goalDate: "2029-01-01" }, "chat", {
      client,
      now: at("2026-10-15"),
    });
    const run = await runAutopilot(userId, { client, now: at("2026-10-15") });
    expect(run.ran && run.fills.length).toBeGreaterThan(0);
    expect(await valueOf(userId, "stocks", "2026-10-15")).toBeLessThan(stocksBefore);
    expect(await valueOf(userId, "safe", "2026-10-15")).toBeGreaterThan(safeBefore);
  });
});
