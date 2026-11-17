import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { provenSavings } from "@/lib/savings-proof";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// A sample person's past wins count back from the demo bank's day, the day its transactions
// count back from, whatever the person's own day is. On the person's day (#1984), at 9pm in Los
// Angeles the refund was looked for the day before it came, so /saved showed one win Held, not
// two (main red at 12f3e923, e2e/ledger.spec.ts, run at 05:05Z).

const url = process.env.TEST_DATABASE_URL;

const CLOCKS = [
  // UTC's morning, the evening before in Los Angeles: the person's day is behind UTC's.
  { name: "9pm in Los Angeles", timezone: "America/Los_Angeles", now: "2026-10-24T04:00:00Z" },
  // UTC's evening, the next morning in Tokyo: the person's day is ahead of UTC's.
  { name: "8am in Tokyo", timezone: "Asia/Tokyo", now: "2026-10-23T23:00:00Z" },
  // The same day either side.
  { name: "8am in Los Angeles", timezone: "America/Los_Angeles", now: "2026-10-23T15:00:00Z" },
] as const;
const emailOf = (i: number) => `sample-wins-bank-day-${i}@example.com`;

describe.runIf(url)("a sample person's wins on the demo bank's day", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await client.user.deleteMany({ where: { email: { in: CLOCKS.map((_, i) => emailOf(i)) } } });
    for (const [i, c] of CLOCKS.entries()) {
      const now = new Date(c.now);
      const user = await client.user.create({
        data: { email: emailOf(i), timezone: c.timezone },
      });
      made.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now, person: "renter" });
      await syncItem(itemId, { client, now });
    }
  }, 600_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(CLOCKS.map((c, i) => ({ ...c, i })))(
    "$name: both wins are confirmed by their own lines",
    async ({ i, now }) => {
      const proven = await provenSavings(made[i]!, { client, now: new Date(now) });
      expect(proven.confirmed.map((r) => r.kind).sort()).toEqual(["cancelled", "refund"]);
      expect(proven.confirmed.every((r) => r.heldOn !== null)).toBe(true);
    },
  );
});
