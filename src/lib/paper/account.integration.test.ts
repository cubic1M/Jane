import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { Bar } from "@/lib/market/types";
import {
  PaperError,
  loadPaperView,
  revertTrade,
  runPaperDay,
  skipSignal,
  startPaperAccount,
  takeSignal,
} from "./account";
import type { PaperPrices } from "./prices";
import { openSignalCards } from "./signals";

// The paper account against a real, migrated Postgres, on made-up closes standing in for the real
// daily ones: started from the person's strategy, valued each day, the rule's trades left for the
// pop-up, then paper traded, reverted and skipped. Demo bank only (advice mode).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T21:30:00Z");

// Weekday closes for any ticker: a steady climb from a price set by its name.
const fakePrices = (bump: Record<string, number> = {}): PaperPrices => ({
  name: "sample",
  real: false,
  closes: async (ticker: string, from: string, to: string) => {
    const out: Bar[] = [];
    const base = 5_000 + [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0) * 20;
    let i = 0;
    for (
      let d = Date.parse(`${from}T00:00:00Z`);
      d <= Date.parse(`${to}T00:00:00Z`);
      d += 86_400_000
    ) {
      const day = new Date(d).getUTCDay();
      if (day === 0 || day === 6) continue;
      i += 1;
      out.push({
        date: new Date(d).toISOString().slice(0, 10),
        closeCents: Math.round(base * 1.0004 ** i * (bump[ticker] ?? 1)),
      });
    }
    return out;
  },
});

describe.runIf(url)("the paper account", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (bank: "demo" | "real") => {
    const user = await client.user.create({
      data: { email: `paper-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `${bank === "demo" ? "demo-" : "item-"}${crypto.randomUUID()}`,
        accessTokenEncrypted: "test-token",
        institutionName: bank === "demo" ? "Demo Bank" : "First Real Bank",
      },
    });
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts with the balance, bought into the strategy, valued, logged and counted", async () => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() });
    const view = (await loadPaperView(id, { client }))!;
    expect(view.startingCents).toBe(1_000_000);
    expect(view.positions.length).toBeGreaterThan(0);
    // Every cent is in a fund or in cash.
    expect(Math.abs(view.valueCents - 1_000_000)).toBeLessThan(10);
    expect(view.values).toHaveLength(1);
    expect(view.trades.every((t) => t.source === "start")).toBe(true);
    expect(view.strategy).toMatch(/Jane's pick|Your level's mix/);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id },
      "paper_account_started",
      expect.objectContaining({ type: "paper_account" }),
      expect.objectContaining({ startingCents: 1_000_000, simulated: "true" }),
    );
    expect(track).toHaveBeenCalledWith(id, "paper_account_started", expect.any(Object));
    // Once only, and a sensible balance.
    await expect(
      startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() }),
    ).rejects.toThrow(PaperError);
    const other = await person("demo");
    await expect(
      startPaperAccount(other, 5, { client, now: NOW, prices: fakePrices() }),
    ).rejects.toThrow(/starting balance/);
  });

  it("never runs for a real account", async () => {
    const id = await person("real");
    await expect(
      startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() }),
    ).rejects.toThrow(/demo bank only/);
  });

  it("leaves the rule's trades in the pop-up; paper trade, revert and skip each work at once", async () => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() });
    // Its funds drift: everything is sold to cash, so the rule wants it all back.
    const account = await client.paperAccount.findUniqueOrThrow({ where: { userId: id } });
    const positions = await client.paperPosition.findMany({ where: { userId: id } });
    await client.paperPosition.deleteMany({ where: { userId: id } });
    await client.paperAccount.update({
      where: { id: account.id },
      data: { cashCents: 1_000_000 },
    });
    expect(positions.length).toBeGreaterThan(0);
    const later = new Date("2026-10-21T22:00:00Z");
    const report = await runPaperDay(id, { client, now: later, prices: fakePrices() });
    expect(report.ran).toBe(true);
    expect(report.signals).toBeGreaterThan(0);
    // Again the same day: nothing new, one value a day.
    expect((await runPaperDay(id, { client, now: later, prices: fakePrices() })).signals).toBe(0);
    expect((await loadPaperView(id, { client }))!.values).toHaveLength(2);

    const cards = await openSignalCards(id, { client });
    expect(cards.length).toBe(report.signals);
    for (const c of cards) {
      expect(c.side).toBe("buy");
      expect(c.card.headline).toMatch(/^Buy \$[\d,]+ of [A-Z]+$/);
      expect(c.card.confidence).toBeGreaterThan(0);
      expect(c.card.label).toMatch(/^Demo advice/);
    }

    // Paper trade it: cash goes, the fund comes, the signal is done.
    const first = cards[0];
    const taken = await takeSignal(id, first.id, { client, now: later });
    if (!taken.ok) throw new Error(taken.error);
    let view = (await loadPaperView(id, { client }))!;
    expect(view.cashCents).toBe(1_000_000 - first.amountCents);
    expect(view.trades.find((t) => t.id === taken.tradeId)?.source).toBe("rule");
    expect((await openSignalCards(id, { client })).map((c) => c.id)).not.toContain(first.id);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id },
      "paper_trade_taken",
      { type: "paper_trade", id: taken.tradeId },
      expect.objectContaining({ ticker: first.ticker, simulated: "true" }),
    );
    // Taken twice: no.
    expect((await takeSignal(id, first.id, { client, now: later })).ok).toBe(false);

    // Revert: the cash is back and the trade waits again.
    expect((await revertTrade(id, taken.tradeId, { client, now: later })).ok).toBe(true);
    view = (await loadPaperView(id, { client }))!;
    expect(view.cashCents).toBe(1_000_000);
    expect(view.trades.find((t) => t.id === taken.tradeId)?.reverted).toBe(true);
    expect((await openSignalCards(id, { client })).map((c) => c.id)).toContain(first.id);
    expect((await revertTrade(id, taken.tradeId, { client, now: later })).ok).toBe(false);

    // Skip: gone from the pop-up, nothing traded.
    expect((await skipSignal(id, first.id, { client, now: later })).ok).toBe(true);
    expect((await openSignalCards(id, { client })).map((c) => c.id)).not.toContain(first.id);
    expect((await loadPaperView(id, { client }))!.cashCents).toBe(1_000_000);

    // Someone else can't touch it.
    const stranger = await person("demo");
    expect((await takeSignal(stranger, cards[1]?.id ?? first.id, { client, now: later })).ok).toBe(
      false,
    );
  });

  it("a sell taken and reverted leaves the account as it was", async () => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() });
    const account = await client.paperAccount.findUniqueOrThrow({ where: { userId: id } });
    const before = (await loadPaperView(id, { client }))!;
    const ticker = before.positions[0].ticker;
    const signal = await client.paperSignal.create({
      data: {
        accountId: account.id,
        userId: id,
        createdAt: NOW,
        key: `rule:test:${ticker}:sell`,
        source: "rule",
        ticker,
        side: "sell",
        amountCents: 100_000,
        priceCents: 25_000,
        reason: "A test sell.",
        confidence: 70,
        status: "open",
      },
    });
    const taken = await takeSignal(id, signal.id, { client, now: NOW });
    if (!taken.ok) throw new Error(taken.error);
    expect((await loadPaperView(id, { client }))!.cashCents).toBe(before.cashCents + 100_000);
    const back = await revertTrade(id, taken.tradeId, { client, now: NOW });
    expect(back).toEqual({ ok: true });
    const after = (await loadPaperView(id, { client }))!;
    expect(after.cashCents).toBe(before.cashCents);
    expect(after.trades.find((t) => t.id === taken.tradeId)?.reverted).toBe(true);
  });

  it("brings a recent news idea as its own trade", async () => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, { client, now: NOW, prices: fakePrices() });
    // Room in cash for it.
    const account = await client.paperAccount.findUniqueOrThrow({ where: { userId: id } });
    await client.paperAccount.update({ where: { id: account.id }, data: { cashCents: 200_000 } });
    const portfolio = await client.practicePortfolio.create({
      data: { userId: id, level: 3, startingCents: 100_000, cashCents: 100_000, startedAt: NOW },
    });
    await client.practiceOpportunity.create({
      data: {
        portfolioId: portfolio.id,
        userId: id,
        scannedAt: new Date("2026-10-21T21:00:00Z"),
        kind: "theme_idea",
        ticker: "ITA",
        key: "theme:defense:2026-10-21",
        amountCents: 40_000,
        headline: "Defense when a war breaks out",
        reason: "A war broke out; defense funds beat the market after 7 of 9 such events",
        confidence: 60,
        details: {},
        status: "suggested",
      },
    });
    await runPaperDay(id, { client, now: new Date("2026-10-21T22:00:00Z"), prices: fakePrices() });
    const news = (await openSignalCards(id, { client })).find((c) => c.source === "news")!;
    expect(news.ticker).toBe("ITA");
    expect(news.amountCents).toBe(40_000);
    expect(news.card.confidence).toBe(60);
    expect(news.card.reason).toMatch(/7 of 9/);
  });
});
