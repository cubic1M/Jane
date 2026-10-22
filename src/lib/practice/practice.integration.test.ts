import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { balances, replay, type Entry } from "@/planning/practice-ledger";
import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import { LedgerError } from "@/planning/practice-ledger";
import { logAudit } from "@/lib/audit";
import { practiceBroker } from "./broker";
import { runAutopilot, setPaused, tradeLog, undoLastTrade } from "./autopilot";
import { addPracticeMoney, loadPractice, PracticeError, startPractice } from "./portfolio";

// Spec step 290 against a real, migrated Postgres: the practice ledger balances to the cent,
// cannot borrow or sell short, can be rebuilt from its trades, and never touches a real account.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");

describe.runIf(url)("the practice portfolio", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `practice-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts once with practice cash, and says so in its log", async () => {
    const userId = await person();
    await startPractice(userId, 3, { client, now: NOW });
    await expect(startPractice(userId, 3, { client, now: NOW })).rejects.toThrow(PracticeError);
    const view = await loadPractice(userId, { client, now: NOW });
    expect(view).toMatchObject({ level: 3, paused: false });
    expect(view!.state.cashCents).toBe(view!.startingCents);
    expect(view!.totalCents).toBe(view!.startingCents);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "practice_started",
      expect.anything(),
      expect.objectContaining({ simulated: "true" }),
    );
  });

  it("buys and sells at the market's price, keeps a reason on every trade, and balances to the cent", async () => {
    const userId = await person();
    await startPractice(userId, 5, { client, now: NOW });
    const broker = practiceBroker();
    const buy = await broker.placeOrder(
      userId,
      {
        ticker: "vti",
        side: "buy",
        amountCents: 400_000,
        reason: "Buying the model's US stocks.",
        rule: "model_buy",
      },
      { client, now: NOW },
    );
    expect(buy).toMatchObject({ ticker: "VTI", simulated: true });
    await broker.placeOrder(
      userId,
      {
        ticker: "BND",
        side: "buy",
        amountCents: 250_000,
        reason: "Buying the model's bonds.",
        rule: "model_buy",
      },
      { client, now: NOW },
    );
    const sell = await broker.placeOrder(
      userId,
      {
        ticker: "VTI",
        side: "sell",
        amountCents: 100_000,
        reason: "Trimming after a rise.",
        rule: "rebalance",
      },
      { client, now: NOW },
    );
    expect(sell.gainCents).not.toBeNull();
    await addPracticeMoney(userId, 50_000, "Monthly practice add.", "monthly_add", {
      client,
      now: NOW,
    });

    const trades = await client.practiceTrade.findMany({
      where: { userId },
      orderBy: { placedAt: "asc" },
    });
    expect(trades.every((t) => t.reason !== "" && t.rule !== "")).toBe(true);
    const entries: Entry[] = trades.map((t) =>
      t.side === "deposit"
        ? { side: "deposit", amountCents: t.amountCents }
        : {
            side: t.side as "buy" | "sell",
            ticker: t.ticker!,
            amountCents: t.amountCents,
            priceCents: t.priceCents!,
          },
    );
    const view = await loadPractice(userId, { client, now: NOW });
    expect(balances(view!.startingCents, entries.slice(1), view!.state)).toBe(true);
    const rebuilt = replay(0, entries, PRACTICE_UNIVERSE);
    expect(rebuilt.cashCents).toBe(view!.state.cashCents);
    expect(Object.keys(rebuilt.positions).sort()).toEqual(
      Object.keys(view!.state.positions).sort(),
    );
    expect(await broker.positions(userId, { client })).toHaveLength(2);
  });

  it("refuses borrowing, selling short and anything outside the universe", async () => {
    const userId = await person();
    await startPractice(userId, 2, { client, now: NOW });
    const broker = practiceBroker();
    const order = { reason: "test", rule: "test" } as const;
    await expect(
      broker.placeOrder(
        userId,
        { ...order, ticker: "VTI", side: "buy", amountCents: 99_999_999 },
        { client, now: NOW },
      ),
    ).rejects.toThrow(LedgerError);
    await expect(
      broker.placeOrder(
        userId,
        { ...order, ticker: "VTI", side: "sell", amountCents: 100 },
        { client, now: NOW },
      ),
    ).rejects.toThrow(/short/);
    await expect(
      broker.placeOrder(
        userId,
        { ...order, ticker: "SPY240621C", side: "buy", amountCents: 100 },
        { client, now: NOW },
      ),
    ).rejects.toThrow(LedgerError);
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(1);
  });

  it("is one person's own: another person sees no portfolio", async () => {
    const a = await person();
    const b = await person();
    await startPractice(a, 4, { client, now: NOW });
    expect(await loadPractice(b, { client, now: NOW })).toBeNull();
    await expect(
      practiceBroker().placeOrder(
        b,
        { ticker: "VTI", side: "buy", amountCents: 100, reason: "x", rule: "x" },
        { client, now: NOW },
      ),
    ).rejects.toThrow(/Start a practice portfolio/);
  });

  it("never reaches the real brokerage stand-in or any account", () => {
    for (const file of ["broker.ts", "portfolio.ts"]) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(text, file).not.toMatch(
        /from "@\/lib\/brokerage|brokeragePartner|placeOrders|scheduleTransfer/,
      );
    }
  });

  it("autopilot buys the model with a reason on every trade, then does nothing more that day", async () => {
    const userId = await person();
    await startPractice(userId, 3, { client, now: NOW });
    const first = await runAutopilot(userId, { client, now: NOW });
    expect(first.ran && first.fills.length).toBeGreaterThan(2);
    const log = await tradeLog(userId, { client });
    expect(
      log
        .filter((t) => t.side === "buy")
        .every((t) => t.reason.length > 20 && t.rule === "model_buy"),
    ).toBe(true);
    const view = await loadPractice(userId, { client, now: NOW });
    // Nearly everything is invested, in the model's proportions for Medium.
    expect(view!.state.cashCents).toBeLessThan(view!.totalCents * 0.02);
    const again = await runAutopilot(userId, { client, now: NOW });
    expect(again.ran && again.fills).toEqual([]);
  });

  it("adds the monthly practice money once a month", async () => {
    const userId = await person();
    await startPractice(userId, 2, { client, now: NOW });
    const a = await runAutopilot(userId, { client, now: NOW });
    expect(a.ran && a.deposit).toBe(true);
    const b = await runAutopilot(userId, { client, now: new Date("2026-10-20T15:00:00Z") });
    expect(b.ran && b.deposit).toBe(false);
    const c = await runAutopilot(userId, { client, now: new Date("2026-11-03T15:00:00Z") });
    expect(c.ran && c.deposit).toBe(true);
    expect(await client.practiceTrade.count({ where: { userId, rule: "monthly_add" } })).toBe(2);
  });

  it("does nothing when paused, and resumes", async () => {
    const userId = await person();
    await startPractice(userId, 4, { client, now: NOW });
    await setPaused(userId, "all", true, { client });
    expect(await runAutopilot(userId, { client, now: NOW })).toEqual({ ran: false, why: "paused" });
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(1);
    await setPaused(userId, "all", false, { client });
    const r = await runAutopilot(userId, { client, now: NOW });
    expect(r.ran && r.fills.length).toBeGreaterThan(0);
  });

  it("undoes the last trade by rebuilding the ledger, never the starting money", async () => {
    const userId = await person();
    await startPractice(userId, 5, { client, now: NOW });
    await runAutopilot(userId, { client, now: NOW });
    const before = await loadPractice(userId, { client, now: NOW });
    const trades = await client.practiceTrade.count({
      where: { userId, undone: false, side: { in: ["buy", "sell"] } },
    });
    const u = await undoLastTrade(userId, { client });
    expect(u.side).toMatch(/buy|sell/);
    const after = await loadPractice(userId, { client, now: NOW });
    expect(after!.state.cashCents).toBeGreaterThan(before!.state.cashCents);
    expect(
      await client.practiceTrade.count({
        where: { userId, undone: false, side: { in: ["buy", "sell"] } },
      }),
    ).toBe(trades - 1);
    const rest = await client.practiceTrade.findMany({
      where: { userId, undone: false },
      orderBy: { placedAt: "asc" },
    });
    expect(rest[0].rule).toBe("start");
    for (let i = 0; i < 20; i += 1) {
      try {
        await undoLastTrade(userId, { client });
      } catch {
        break;
      }
    }
    await expect(undoLastTrade(userId, { client })).rejects.toThrow(PracticeError);
    expect((await loadPractice(userId, { client, now: NOW }))!.state.cashCents).toBe(
      before!.startingCents + (rest.filter((t) => t.rule === "monthly_add").length ? 0 : 0),
    );
  });
});
