import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { NO_PLAID } from "@/lib/__fixtures__/plaid";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadMatchPace } from "./match-pace";

// Gate C's calendar sweep (src/sweep/), 11-15: on the demo person the 401(k) match suggestion was
// worth $784 at 3pm and $789 at 7pm the same day, and more each day with nothing new in the
// account. The pace is the same at both hours and on any later day with the same data.

const url = process.env.TEST_DATABASE_URL;
// Linked and synced on Nov 10 at 8am in Los Angeles.
const LINKED = new Date("2026-11-10T16:00:00Z");
// 3pm and 7pm on Nov 15 in Los Angeles; 7pm is already Nov 16 in UTC.
const AFTERNOON = new Date("2026-11-15T23:00:00Z");
const EVENING = new Date("2026-11-16T03:00:00Z");
const LATER = new Date("2026-11-29T23:00:00Z");

describe.runIf(url)("the match pace on the person's own calendar", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `match-pace-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: NO_PLAID, now: LINKED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is the same at 7pm as at 3pm, and two weeks on with nothing new", async () => {
    const pace = (now: Date) => loadMatchPace(userId, { client, now });
    const afternoon = await pace(AFTERNOON);
    expect(afternoon?.employeeRate).toBeGreaterThan(0);
    expect(await pace(EVENING)).toEqual(afternoon);
    expect(await pace(LATER)).toEqual(afternoon);
  });
});
