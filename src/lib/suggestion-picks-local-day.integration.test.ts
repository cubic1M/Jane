import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { offeredToday, scanSuggestions } from "./suggestions";

// Gate C (debug 3, 11-16): the scan chose its picks on UTC's day. A sync landing at 7pm in Los
// Angeles (UTC's tomorrow) chose a new three, dated tomorrow, beside a brief dated today; and a
// pick lapsed at 7pm a day before it did at 3pm. Picks are the person's day's, and last their
// days.

const url = process.env.TEST_DATABASE_URL;
// 8am, 3pm and 7pm in Los Angeles on Nov 10 (UTC-8).
const MORNING = new Date("2026-11-10T16:00:00Z");
const AFTERNOON = new Date("2026-11-10T23:00:00Z");
const EVENING = new Date("2026-11-11T03:00:00Z");
// 3pm and 7pm on Nov 23, the picks' last day, and 3pm on Nov 24.
const LAST_AFTERNOON = new Date("2026-11-23T23:00:00Z");
const LAST_EVENING = new Date("2026-11-24T03:00:00Z");
const AFTER = new Date("2026-11-24T23:00:00Z");

describe.runIf(url)("the scan's picks on the person's day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const trial = await startTrial({ client, now: MORNING, defer: true, person: "debt" });
    userId = trial.userId;
    await client.user.update({ where: { id: userId }, data: { timezone: "America/Los_Angeles" } });
    await syncItem(trial.itemId, { client, now: MORNING });
    await scanSuggestions(userId, { client, now: MORNING });
  }, 180_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const picks = async (now: Date) =>
    (await offeredToday(userId, { client, now })).map((o) => `${o.key}:${o.chosenOn}`);

  it("keeps the morning's picks through an evening scan, dated their day", async () => {
    const afternoon = await picks(AFTERNOON);
    expect(afternoon.length).toBeGreaterThan(0);
    expect(afternoon.every((p) => p.endsWith(":2026-11-10"))).toBe(true);
    await scanSuggestions(userId, { client, now: EVENING });
    expect(await picks(EVENING)).toEqual(afternoon);
  });

  it("lapses them on the same day at any hour", async () => {
    const chosen = await picks(AFTERNOON);
    expect(await picks(LAST_AFTERNOON)).toEqual(chosen);
    expect(await picks(LAST_EVENING)).toEqual(chosen);
    expect(await picks(AFTER)).toEqual([]);
  });
});
