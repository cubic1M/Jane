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
import { linkDemoHsa, loadHsa } from "./hsa";
import { loadRetirement } from "./retirement";
import { loadRetirementAccounts } from "./retirement-accounts";

// Tax T32c: the 401(k) room and the retirement accounts' limits are the limits of the year of the
// person's own day: the 2026 figures on December 31 2026, the 2027 figures from January 1 2027
// (Notice 2025-67: 24,500 dollars; Notice 2026-66: 25,500 dollars), and nothing for a year without
// figures. In Los Angeles, 9pm on December 31 is already January 1 in UTC: still 2026.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-11-10T16:00:00Z");
const NEW_YEARS_EVE_3PM = new Date("2026-12-31T23:00:00Z");
const NEW_YEARS_EVE_9PM = new Date("2027-01-01T05:00:00Z");
const JAN_2 = new Date("2027-01-02T20:00:00Z");
const JAN_2_2028 = new Date("2028-01-02T20:00:00Z");

describe.runIf(url)("the retirement limits on the person's own calendar", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `limits-year-${crypto.randomUUID()}@example.com`,
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

  it("gives the 401(k) room card each year's own limit", async () => {
    const room = async (now: Date) =>
      (await loadRetirement(userId, { client, now, guessedAge: 45 })).retirement;
    const eve = await room(NEW_YEARS_EVE_3PM);
    expect(eve).toMatchObject({ limitYear: 2026, limitCents: 2_450_000 });
    expect(await room(NEW_YEARS_EVE_9PM)).toMatchObject({ limitYear: 2026, limitCents: 2_450_000 });
    const january = await room(JAN_2);
    expect(january).toMatchObject({ limitYear: 2027, limitCents: 2_550_000 });
    // Room is the year's limit (plus catch-up) less the last 12 months put in, so it moves with the limit.
    expect(january!.roomCents).toBeLessThanOrEqual(2_550_000 + january!.catchUpCents);
  });

  it("gives the retirement accounts page each year's own limits and source", async () => {
    const view = async (now: Date) => loadRetirementAccounts(userId, { client, now });
    const eve = await view(NEW_YEARS_EVE_3PM);
    expect(eve.limitsSource).toMatch(/Notice 2025-67 \(2026 limits\)/);
    const january = await view(JAN_2);
    expect(january.limitsSource).toMatch(/Notice 2026-66 \(2027 limits\)/);
    expect(january.limits[0].limitCents - eve.limits[0].limitCents).toBe(100_000);
  });

  // Rev. Proc. 2025-19 section 2.01: 4,400 dollars self-only for 2026; Rev. Proc. 2026-24 section
  // 3.01(1): 4,500 for 2027. The same contributions leave 100 dollars more room on January 2.
  it("gives the HSA room card each year's own limit", async () => {
    await linkDemoHsa(userId, { client, now: LINKED });
    const plan = async (now: Date) => (await loadHsa(userId, { client, now })).plan;
    const eve = await plan(NEW_YEARS_EVE_3PM);
    expect(eve).toMatchObject({ limitYear: 2026 });
    expect(await plan(NEW_YEARS_EVE_9PM)).toMatchObject({ limitYear: 2026 });
    const january = await plan(JAN_2);
    expect(january).toMatchObject({ limitYear: 2027 });
    expect(january!.limitCents - eve!.limitCents).toBe(10_000);
    expect(january!.limitSource).toMatch(/Rev\. Proc\. 2026-24 \(2027 HSA limits\)/);
    expect((await plan(JAN_2_2028)) ?? null).toBeNull();
  });

  it("has no plan for a year without figures, never the last year's limit", async () => {
    expect(
      (await loadRetirement(userId, { client, now: JAN_2_2028, guessedAge: 45 })).retirement,
    ).toBeNull();
    await expect(loadRetirementAccounts(userId, { client, now: JAN_2_2028 })).rejects.toMatchObject(
      { name: "NoTaxParamsError" },
    );
  });
});
