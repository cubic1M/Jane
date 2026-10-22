import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("./opportunity-prefs", async (original) => {
  const actual = await original<typeof import("./opportunity-prefs")>();
  return { ...actual, scanPreferences: vi.fn(actual.scanPreferences) };
});

import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { DEFAULT_SCAN_PREFERENCES } from "@/planning/practice-opportunities";
import { scanPreferences } from "./opportunity-prefs";
import { runAutopilot, setPaused } from "./autopilot";
import { addPracticeMoney, startPractice } from "./portfolio";
import { runPracticeDay, scanPractice } from "./scan";

// Spec step 292 against a real, migrated Postgres: the daily scan acts on the sample market's
// planted events in the practice ledger only, keeps every flag with its numbers, never acts on
// the same event twice, honours both pause switches and never makes a wash sale. After step 292:
// ideas only in demo advice mode (a real account gets the autopilot's rebalance alone), the new
// kinds are kept with their numbers, and suggest-only mode trades nothing.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:00:00Z`);

describe.runIf(url)("the daily scan of a practice portfolio", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (level: 1 | 2 | 3 | 4 | 5, day: string, bank: "demo" | "real" = "demo") => {
    const user = await client.user.create({
      data: { email: `practice-scan-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (bank === "demo") await linkDemoBank(user.id, { client });
    else {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt("access-sandbox-real"),
          institutionName: "First Real Bank",
        },
      });
    }
    await startPractice(user.id, level, { client, now: at(day) });
    await runAutopilot(user.id, { client, now: at(day) });
    return user.id;
  };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("harvests losses and buys the dip in this autumn's dip, once, without a wash sale", async () => {
    const userId = await person(4, "2026-09-01");
    const day = await runPracticeDay(userId, { client, now: at("2026-10-14") });
    expect(day?.scan.scanned).toBe(true);
    const flags = day!.scan.scanned ? day!.scan.flags : [];
    expect(flags).toContainEqual(
      expect.objectContaining({ kind: "tax_loss_harvest", ticker: "VTI", status: "acted" }),
    );
    expect(flags).toContainEqual(expect.objectContaining({ kind: "dip_buy", status: "acted" }));

    const rows = await client.practiceOpportunity.findMany({ where: { userId } });
    expect(rows.length).toBe(flags.length);
    for (const r of rows.filter((row) => row.status === "acted")) {
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(30);
      expect(r.tradeIds.length).toBeGreaterThan(0);
    }
    const trades = await client.practiceTrade.findMany({
      where: { userId, placedAt: { gte: at("2026-10-14") } },
    });
    // VTI was sold at a loss: nothing that day bought it back.
    expect(trades.some((t) => t.ticker === "VTI" && t.side === "sell")).toBe(true);
    expect(trades.some((t) => t.ticker === "VTI" && t.side === "buy")).toBe(false);
    expect(trades.every((t) => t.reason.length > 20)).toBe(true);
    const itot = await client.practicePosition.findFirst({ where: { userId, ticker: "ITOT" } });
    expect(itot).not.toBeNull();
    // Every trade wrote an audit row.
    const placed = trades.filter((t) => t.side !== "deposit");
    const calls = vi.mocked(logAudit).mock.calls;
    const audited = calls.filter(([, , target]) => placed.some((t) => t.id === target?.id));
    expect(audited.length).toBe(placed.length);

    // The same day again, and the next: nothing is acted on twice.
    const again = await scanPractice(userId, { client, now: at("2026-10-14") });
    expect(again).toEqual({ scanned: true, flags: [] });
    const next = await scanPractice(userId, { client, now: at("2026-10-15") });
    expect(next.scanned && next.flags.some((f) => f.kind === "tax_loss_harvest")).toBe(false);
  });

  it("stops before the next scan when paused, and leaves out ideas while opportunities are paused", async () => {
    const userId = await person(5, "2026-09-01");
    await addPracticeMoney(userId, 50_000, "Practice money for the test.", "test", {
      client,
      now: at("2026-10-08"),
    });
    await setPaused(userId, "all", true, { client });
    expect(await scanPractice(userId, { client, now: at("2026-10-09") })).toEqual({
      scanned: false,
      why: "paused",
    });
    await setPaused(userId, "all", false, { client });
    await setPaused(userId, "opportunities", true, { client });
    const paused = await scanPractice(userId, { client, now: at("2026-10-09") });
    expect(paused.scanned && paused.flags.some((f) => f.kind === "news_idea")).toBe(false);

    await setPaused(userId, "opportunities", false, { client });
    const on = await scanPractice(userId, { client, now: at("2026-10-09") });
    expect(on.scanned && on.flags).toContainEqual(
      expect.objectContaining({ kind: "news_idea", ticker: "NVDA", status: "acted" }),
    );
    const nvda = await client.practicePosition.findFirst({ where: { userId, ticker: "NVDA" } });
    expect(nvda).not.toBeNull();
  });

  it("never brings an opportunity below High", async () => {
    const userId = await person(3, "2026-09-01");
    await addPracticeMoney(userId, 50_000, "Practice money for the test.", "test", {
      client,
      now: at("2026-10-08"),
    });
    const scan = await scanPractice(userId, { client, now: at("2026-10-09") });
    expect(scan.scanned && scan.flags.some((f) => f.kind === "news_idea")).toBe(false);
  });

  it("gives a real account no ideas: the autopilot's rebalance only", async () => {
    const userId = await person(4, "2026-09-01", "real");
    await addPracticeMoney(userId, 50_000, "Practice money for the test.", "test", {
      client,
      now: at("2026-10-08"),
    });
    for (const day of ["2026-10-09", "2026-10-14"]) {
      const scan = await scanPractice(userId, { client, now: at(day) });
      expect(scan.scanned && scan.flags.every((f) => f.kind === "drift_rebalance")).toBe(true);
    }
    const rows = await client.practiceOpportunity.findMany({ where: { userId } });
    expect(rows.every((r) => r.kind === "drift_rebalance")).toBe(true);
  });

  it("suggests and trades nothing in suggest-only mode, keeping each flag's trades for later", async () => {
    const userId = await person(4, "2026-09-01");
    vi.mocked(scanPreferences).mockResolvedValueOnce({
      ...DEFAULT_SCAN_PREFERENCES,
      mode: "suggest",
    });
    const before = await client.practiceTrade.count({ where: { userId } });
    const scan = await scanPractice(userId, { client, now: at("2026-10-14") });
    expect(scan.scanned && scan.flags.length).toBeGreaterThan(0);
    expect(scan.scanned && scan.flags.every((f) => f.trades === 0)).toBe(true);
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(before);
    const rows = await client.practiceOpportunity.findMany({ where: { userId } });
    const harvest = rows.find((r) => r.kind === "tax_loss_harvest");
    expect(harvest?.status).toBe("suggested");
    const details = harvest?.details as { trades: unknown[]; mode: string };
    expect(details.mode).toBe("suggest");
    expect(details.trades.length).toBe(2);
  });

  it("keeps the new kinds with their numbers: the stated drop near, in the 2020 shock", async () => {
    const userId = await person(4, "2020-02-18");
    await client.investorProfile.create({ data: { userId, dropReaction: "worry" } });
    const scan = await scanPractice(userId, { client, now: at("2020-03-23") });
    expect(scan.scanned && scan.flags).toContainEqual(
      expect.objectContaining({ kind: "max_drop_near", status: "suggested", trades: 0 }),
    );
    const row = await client.practiceOpportunity.findFirst({
      where: { userId, kind: "max_drop_near" },
    });
    const details = row?.details as { figures: unknown[]; caps: unknown[]; trades: unknown[] };
    expect(details.figures.length).toBeGreaterThan(0);
    expect(details.caps.length).toBeGreaterThan(0);
    expect(details.trades).toEqual([]);
    expect(row?.confidence).toBeGreaterThan(0);
  });
});
