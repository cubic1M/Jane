import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { BANK_BALANCE_STALE_DAYS } from "@/config/detection/forecast";
import { loadDetectionInput } from "@/detection/input";
import { FILE_SOURCE } from "@/lib/import/balances";

// CodeRabbit 1c detn-01 #7: a bank sync rewrites an account's balance but leaves an older
// uploaded-statement snapshot in place, so the balance kept the snapshot's day and the forecast
// walked a balance that already held those days forward a second time.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("a synced balance over an older statement snapshot", () => {
  let client: PrismaClient;
  const people: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  // A linked account holding a statement snapshot from `snapshotDaysAgo`, synced `syncedDaysAgo`.
  const linked = async (snapshotDaysAgo: number, syncedDaysAgo: number) => {
    const { id: userId } = await client.user.create({
      data: { email: `synced-${crypto.randomUUID()}@example.com` },
    });
    people.push(userId);
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `real-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
        status: "active",
        lastSyncedAt: new Date(NOW.getTime() - syncedDaysAgo * DAY),
        accounts: {
          create: {
            userId,
            source: "plaid",
            name: "Checking",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 100_000,
          },
        },
      },
      select: { accounts: { select: { id: true } } },
    });
    const accountId = item.accounts[0]!.id;
    await client.balanceSnapshot.create({
      data: {
        userId,
        accountId,
        date: new Date(
          `${new Date(NOW.getTime() - snapshotDaysAgo * DAY).toISOString().slice(0, 10)}T00:00:00Z`,
        ),
        balanceCents: 90_000,
        source: FILE_SOURCE,
      },
    });
    return loadDetectionInput(userId, { client, now: NOW });
  };

  it("doesn't date last night's synced balance from the older snapshot", async () => {
    const input = await linked(20, 1);
    expect(input.accounts[0]?.balanceAsOf).toBeUndefined();
  });

  it("dates a days-old synced balance from its sync, not the older snapshot", async () => {
    const input = await linked(40, BANK_BALANCE_STALE_DAYS + 10);
    expect(input.accounts[0]?.balanceAsOf).toBe("2026-10-22");
  });

  it("keeps a statement snapshot that is newer than the sync", async () => {
    const input = await linked(2, 10);
    expect(input.accounts[0]?.balanceAsOf).toBe("2026-11-02");
  });
});
