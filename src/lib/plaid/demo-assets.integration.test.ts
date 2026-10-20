import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { netWorth } from "@/insights/net-worth";
import { linkDemoBank } from "./demo";
import { ensureDemoAssets } from "./demo-assets";
import { syncItem } from "./sync";

// The demo bank's home and car against a real, migrated Postgres: its sample person's net
// worth counts what the mortgage and the car loan are against, instead of showing only debts.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T15:00:00Z");

describe.runIf(url)("the demo bank's home and car", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function demoPerson() {
    const user = await client.user.create({
      data: { email: `demo-assets-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    return { userId: user.id, itemId };
  }

  it("gives the sample person a home and a car, each against its loan, once", async () => {
    const { userId, itemId } = await demoPerson();
    const assets = await client.ownedAsset.findMany({
      where: { userId },
      include: { loanAccount: { select: { subtype: true } } },
      orderBy: { kind: "asc" },
    });
    expect(assets.map((a) => [a.kind, a.valueCents, a.loanAccount?.subtype])).toEqual([
      ["home", 38_000_000, "mortgage"],
      ["vehicle", 2_450_000, "auto"],
    ]);
    // A later sync, or asking again, adds nothing; removed ones aren't put back by the person's edits.
    await syncItem(itemId, { client, api: plaid, now: new Date(NOW.getTime() + 86_400_000) });
    expect(await ensureDemoAssets(userId, itemId, { client, now: NOW })).toBe(0);
    expect(await client.ownedAsset.count({ where: { userId } })).toBe(2);
  }, 60_000);

  it("makes the sample person's net worth positive instead of -$226,000", async () => {
    const { userId } = await demoPerson();
    const accounts = await client.account.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, currentBalanceCents: true },
    });
    const owned = await client.ownedAsset.findMany({
      where: { userId },
      select: { valueCents: true },
    });
    const without = netWorth(
      accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })) as never,
    );
    const withHome = netWorth(
      accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })) as never,
      owned as never,
    );
    expect(without.netCents).toBeLessThan(-20_000_000);
    expect(withHome.netCents).toBeGreaterThan(10_000_000);
  }, 60_000);

  it("leaves a person who already keeps their own assets alone", async () => {
    const user = await client.user.create({
      data: { email: `demo-assets-own-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.ownedAsset.create({
      data: { userId: user.id, kind: "home", name: "Mine", valueCents: 1, valuedOn: NOW },
    });
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    expect(
      (await client.ownedAsset.findMany({ where: { userId: user.id } })).map((a) => a.name),
    ).toEqual(["Mine"]);
  }, 60_000);
});
