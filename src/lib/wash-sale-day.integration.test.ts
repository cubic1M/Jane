import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { NO_PLAID } from "@/lib/__fixtures__/plaid";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate C's calendar sweep (src/sweep/), 11-15: the wash sales Taxes counts were the ones since 61
// days before the moment, in UTC. At 7pm in Los Angeles a wash sale on the window's first day
// fell out of the count while it was still that day for the person ("1 wash sale" at 3pm, none at
// 7pm). The window is counted on their calendar.

const url = process.env.TEST_DATABASE_URL;
// The demo bank linked Oct 18: its PDIFX sale at a loss on Sep 24 is a wash sale.
const LINKED = new Date("2026-10-18T15:00:00Z");
// 3pm and 7pm on Nov 24 in Los Angeles, the 61st day after the sale; 7pm is Nov 25 in UTC.
const AFTERNOON = new Date("2026-11-24T23:00:00Z");
const EVENING = new Date("2026-11-25T03:00:00Z");

describe.runIf(url)("wash sales on the person's own calendar", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `wash-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: NO_PLAID, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("counts the same wash sales at 7pm as at 3pm", async () => {
    const wash = async (now: Date) =>
      (await loadInvestmentTaxes(userId, 2026, { client, now })).washSales.map((w) => w.ticker);
    expect(await wash(AFTERNOON)).toEqual(["PDIFX"]);
    expect(await wash(EVENING)).toEqual(["PDIFX"]);
  });
});
