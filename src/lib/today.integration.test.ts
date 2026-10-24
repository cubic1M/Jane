import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadDetectionInput } from "@/detection/engine";
import { homeSummary } from "@/lib/home";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { localDate, todayOf } from "./today";

// The person's own "today" (founder, 2026-10-23): at 5:30pm in Los Angeles it is already the
// next day in UTC, but tomorrow's bill is still tomorrow.

const url = process.env.TEST_DATABASE_URL;
// Oct 23, 5:30pm Pacific (daylight time) = Oct 24, 00:30 UTC.
const EVENING = new Date("2026-10-24T00:30:00Z");
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

describe("the person's own today", () => {
  it("is their calendar's date, US Pacific when unknown", () => {
    expect(localDate(EVENING, "America/Los_Angeles")).toBe("2026-10-23");
    expect(localDate(EVENING, null)).toBe("2026-10-23");
    expect(localDate(EVENING, "America/New_York")).toBe("2026-10-23");
    expect(localDate(EVENING, "Europe/London")).toBe("2026-10-24");
  });
});

describe.runIf(url)("today against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy({}, { get: () => () => Promise.reject(new Error("no Plaid")) });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `today-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: EVENING });
    await syncItem(itemId, { client, api: plaid as PlaidApi, now: EVENING });
  }, 120_000);
  afterAll(async () => {
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("reads tomorrow's bill as tomorrow at 17:30 Pacific, not today", async () => {
    expect(await todayOf(userId, { client, now: EVENING })).toBe("2026-10-23");
    expect((await loadDetectionInput(userId, { client, now: EVENING })).asOf).toBe("2026-10-23");
    const home = (await homeSummary(userId, { client, now: EVENING }))!;
    expect(home.comingUp.length).toBeGreaterThan(0);
    for (const row of home.comingUp) {
      expect(row.daysLeft, row.label).toBe(days("2026-10-23", row.date));
      if (row.date === "2026-10-24") expect(row.daysLeft, row.label).toBe(1);
    }
  });
});
