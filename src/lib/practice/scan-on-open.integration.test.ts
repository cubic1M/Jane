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

import { ON_OPEN_SCAN_MINUTES } from "@/config/practice-opportunities";
import { linkDemoBank } from "@/lib/plaid/demo";
import { DEFAULT_SCAN_PREFERENCES } from "@/planning/practice-opportunities";
import { runAutopilot, setPaused } from "./autopilot";
import { scanPreferences } from "./opportunity-prefs";
import { startPractice } from "./portfolio";
import { scanOnOpen, scanPractice } from "./scan";

// Constant search (Phase AW, Stage A) against a real, migrated Postgres: the cheap scan when a
// page opens runs at most once an hour, trades nothing, records only what suggests (all of it
// in suggest-only mode), never calls out, and the daily run doesn't repeat what it found.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string, time = "21:00:00") => new Date(`${day}T${time}Z`);

describe.runIf(url)("the practice scan on opening a page", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (level: 1 | 2 | 3 | 4 | 5, day: string) => {
    const user = await client.user.create({
      data: { email: `practice-open-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await linkDemoBank(user.id, { client });
    await client.investorProfile.create({ data: { userId: user.id, dropReaction: "worry" } });
    await startPractice(user.id, level, { client, now: at(day) });
    await runAutopilot(user.id, { client, now: at(day) });
    return user.id;
  };
  const trades = (userId: string) => client.practiceTrade.count({ where: { userId } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("records the safety idea, trades nothing, and leaves the trades to the daily run", async () => {
    const userId = await person(4, "2020-02-18");
    const fetch = vi.spyOn(globalThis, "fetch");
    const before = await trades(userId);
    const open = await scanOnOpen(userId, { client, now: at("2020-03-23", "15:00:00") });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    expect(open?.scanned && open.flags).toContainEqual(
      expect.objectContaining({ kind: "max_drop_near", status: "suggested", trades: 0 }),
    );
    expect(open?.scanned && open.flags.every((f) => f.trades === 0)).toBe(true);
    expect(open?.scanned && open.flags.some((f) => f.kind === "tax_loss_harvest")).toBe(false);
    expect(await trades(userId)).toBe(before);

    // The daily run that evening acts on the harvest, and doesn't repeat the safety idea.
    const daily = await scanPractice(userId, { client, now: at("2020-03-23") });
    expect(daily.scanned && daily.flags.some((f) => f.kind === "max_drop_near")).toBe(false);
    expect(daily.scanned && daily.flags).toContainEqual(
      expect.objectContaining({ kind: "tax_loss_harvest", status: "acted" }),
    );
    const rows = await client.practiceOpportunity.findMany({
      where: { userId, kind: "max_drop_near" },
    });
    expect(rows.length).toBe(1);
  });

  it("runs at most once in ON_OPEN_SCAN_MINUTES", async () => {
    const userId = await person(3, "2026-09-01");
    const first = at("2026-10-08", "12:00:00");
    expect(await scanOnOpen(userId, { client, now: first })).not.toBeNull();
    const soon = new Date(first.getTime() + (ON_OPEN_SCAN_MINUTES - 1) * 60_000);
    expect(await scanOnOpen(userId, { client, now: soon })).toBeNull();
    const later = new Date(first.getTime() + (ON_OPEN_SCAN_MINUTES + 1) * 60_000);
    expect(await scanOnOpen(userId, { client, now: later })).not.toBeNull();
  });

  it("records the trades as suggestions in suggest-only mode, still placing none", async () => {
    const userId = await person(4, "2026-09-01");
    vi.mocked(scanPreferences).mockResolvedValueOnce({
      ...DEFAULT_SCAN_PREFERENCES,
      mode: "suggest",
    });
    const before = await trades(userId);
    const open = await scanOnOpen(userId, { client, now: at("2026-10-14", "15:00:00") });
    expect(open?.scanned && open.flags).toContainEqual(
      expect.objectContaining({ kind: "tax_loss_harvest", status: "suggested", trades: 0 }),
    );
    expect(await trades(userId)).toBe(before);
  });

  it("does nothing while paused or without a practice portfolio", async () => {
    const userId = await person(3, "2026-09-01");
    await setPaused(userId, "all", true, { client });
    expect(await scanOnOpen(userId, { client, now: at("2026-10-08") })).toBeNull();
    const nobody = await client.user.create({
      data: { email: `practice-open-${crypto.randomUUID()}@example.com` },
    });
    created.push(nobody.id);
    expect(await scanOnOpen(nobody.id, { client, now: at("2026-10-08") })).toBeNull();
  });
});
