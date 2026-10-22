import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { runAutopilot, setPaused } from "./autopilot";
import { addPracticeMoney, startPractice } from "./portfolio";
import { runPracticeDay, scanPractice } from "./scan";

// Spec step 292 against a real, migrated Postgres: the daily scan acts on the sample market's
// planted events in the practice ledger only, keeps every flag with its numbers, never acts on
// the same event twice, honours both pause switches and never makes a wash sale.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:00:00Z`);

describe.runIf(url)("the daily scan of a practice portfolio", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (level: 1 | 2 | 3 | 4 | 5, day: string) => {
    const user = await client.user.create({
      data: { email: `practice-scan-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, level, { client, now: at(day) });
    await runAutopilot(user.id, { client, now: at(day) });
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("harvests losses and buys the dip in this autumn's dip, once, without a wash sale", async () => {
    // Low: the rule replay turned harvesting off from Medium up (OPPORTUNITY_RULES_OFF).
    const userId = await person(2, "2026-09-01");
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

  it("doesn't harvest where the rule replay turned harvesting off", async () => {
    const userId = await person(4, "2026-09-01");
    const day = await runPracticeDay(userId, { client, now: at("2026-10-14") });
    const flags = day?.scan.scanned ? day.scan.flags : [];
    expect(flags.some((f) => f.kind === "dip_buy")).toBe(true);
    expect(flags.some((f) => f.kind === "tax_loss_harvest")).toBe(false);
  });
});
