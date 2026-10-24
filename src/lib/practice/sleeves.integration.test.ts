import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { CRYPTO_SLEEVE_BY_LEVEL } from "@/config/crypto-strategies";
import { PRACTICE_MONTHLY_ADD_CENTS } from "@/config/portfolios";
import { proposePracticeChange } from "@/lib/jane-agent/practice-tools";
import { runAutopilot } from "./autopilot";
import { startPractice } from "./portfolio";
import { savePreferences } from "./preferences";

// The crypto and day-trading sleeves in the practice portfolio, against a real, migrated Postgres
// and the sample market: at Very high only, the crypto bought beside the mix and sold whole when
// it's turned off, the day trades in and out the same day, and both refused in the chat below
// Very high.

const url = process.env.TEST_DATABASE_URL;
// A Monday: a week's first trading day.
const MONDAY = new Date("2026-10-19T21:30:00Z");
const NEXT_MONDAY = new Date("2026-10-26T21:30:00Z");

describe.runIf(url)("the crypto sleeve", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (level: 3 | 5, sleeve: string, dayTrading = "off") => {
    const user = await client.user.create({
      data: { email: `sleeve-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await savePreferences(user.id, { riskLevel: level, cryptoSleeve: sleeve, dayTrading }, "page", {
      client,
      now: MONDAY,
    });
    await startPractice(user.id, level, { client, now: MONDAY });
    return user.id;
  };
  const coins = <T extends { ticker: string }>(fills: T[]) =>
    fills.filter((f) => f.ticker === "BTCUSD" || f.ticker === "ETHUSD");

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("buys the sleeve beside the mix at Very high, within its share", async () => {
    const id = await person(5, "crypto_hold");
    const r = await runAutopilot(id, { client, now: MONDAY });
    if (!r.ran) throw new Error("did not run");
    const bought = coins(r.fills);
    expect(bought.map((f) => f.ticker).sort()).toEqual(["BTCUSD", "ETHUSD"]);
    const share = CRYPTO_SLEEVE_BY_LEVEL[5]!;
    for (const f of bought) {
      expect(f.side).toBe("buy");
      // Half the sleeve each, of everything in it (the start, and the month's money if it went in).
      const whole = 1_000_000 + (r.deposit ? PRACTICE_MONTHLY_ADD_CENTS : 0);
      expect(f.amountCents).toBe(Math.round((share / 2) * whole));
    }
    // The mix spent only what the sleeve left: no cash borrowed.
    const portfolio = await client.practicePortfolio.findFirstOrThrow({ where: { userId: id } });
    expect(portfolio.cashCents).toBeGreaterThanOrEqual(0);
    const trades = await client.practiceTrade.findMany({
      where: { userId: id, rule: "crypto_sleeve" },
    });
    expect(trades).toHaveLength(2);
    expect(trades[0].reason).toMatch(/crypto sleeve \(Crypto, held\)/);
  });

  it("holds no crypto below Very high, whatever was chosen", async () => {
    const id = await person(3, "crypto_hold");
    const r = await runAutopilot(id, { client, now: MONDAY });
    if (!r.ran) throw new Error("did not run");
    expect(coins(r.fills)).toEqual([]);
  });

  it("sells the whole sleeve once it's turned off", async () => {
    const id = await person(5, "crypto_hold");
    await runAutopilot(id, { client, now: MONDAY });
    await savePreferences(id, { cryptoSleeve: "off" }, "page", { client, now: MONDAY });
    const r = await runAutopilot(id, { client, now: NEXT_MONDAY });
    if (!r.ran) throw new Error("did not run");
    expect(coins(r.fills).map((f) => f.side)).toEqual(["sell", "sell"]);
    const left = await client.practicePosition.findMany({
      where: { userId: id, ticker: { in: ["BTCUSD", "ETHUSD"] } },
    });
    expect(left.every((p) => p.quantity < 1e-9)).toBe(true);
  });

  it("never day trades, even at Very high: every rule lost money after costs", async () => {
    const id = await person(5, "off", "opening_range");
    for (const d of [19, 20, 21, 22, 23]) {
      const r = await runAutopilot(id, { client, now: new Date(`2026-10-${d}T21:30:00Z`) });
      expect(r.ran && r.fills.filter((f) => f.ticker === "SPY")).toEqual([]);
    }
  });

  it("is refused in the chat below Very high, and carded at it", async () => {
    const low = await person(3, "off");
    const no = await proposePracticeChange(
      low,
      { crypto_sleeve: "crypto_trend" },
      { client, now: MONDAY },
    );
    expect(no).toEqual({ ok: false, error: "The crypto sleeve runs at Very high only." });
    const high = await person(5, "off");
    const yes = await proposePracticeChange(
      high,
      { crypto_sleeve: "crypto_trend" },
      { client, now: MONDAY },
    );
    expect(yes.ok && yes.line).toMatch(/Crypto sleeve \(Very high only\): Off → Crypto trend/);
    const day = await proposePracticeChange(
      low,
      { day_trading: "vwap_reversion" },
      { client, now: MONDAY },
    );
    expect(day.ok).toBe(false);
    expect(!day.ok && day.error).toMatch(/^Day trading isn't offered/);
  });
});
