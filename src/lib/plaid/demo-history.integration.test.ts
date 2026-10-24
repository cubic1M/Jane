import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadHubTop } from "@/lib/hub/load";
import { heroView } from "@/lib/hub/view";
import { linkDemoBank } from "./demo";
import { ensureDemoBalanceHistory } from "./demo-history";
import { syncItem } from "./sync";

// A sample person's net worth line against a real, migrated Postgres: the demo bank's first
// scan writes a year of month-end balances, so the home hub draws the line on day one.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T15:00:00Z");

describe.runIf(url)("the demo bank's balance history", () => {
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

  it("gives a sample person month-end balances, so the hub draws their net worth line", async () => {
    const user = await client.user.create({
      data: { email: `demo-history-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });

    const snapshots = await client.balanceSnapshot.findMany({ where: { userId: user.id } });
    expect(snapshots.length).toBeGreaterThan(0);
    // Month ends only, all before this month.
    for (const s of snapshots) {
      const day = s.date.toISOString().slice(0, 10);
      expect(day < "2026-10-01").toBe(true);
      const next = new Date(s.date.getTime() + 86_400_000);
      expect(next.getUTCDate()).toBe(1);
    }

    const top = await loadHubTop(user.id, { client, now: NOW });
    const line = heroView(top!.hero).netWorth!;
    expect(line.points.length).toBeGreaterThan(2);
    // The line ends at the headline: every account counts, and this month is today.
    expect(line.points.at(-1)!.cents).toBe(line.cents);
    // Every bank, card and loan account has its history; investments never get one here.
    const banks = await client.account.findMany({
      where: { userId: user.id, type: { in: ["depository", "credit", "loan"] } },
      select: { id: true },
    });
    const counted = new Set(snapshots.map((s) => s.accountId));
    for (const b of banks) expect(counted.has(b.id)).toBe(true);
    const investing = await client.account.findMany({
      where: { userId: user.id, type: "investment" },
      select: { id: true },
    });
    for (const i of investing) expect(counted.has(i.id)).toBe(false);

    // Running it again writes nothing new.
    expect(await ensureDemoBalanceHistory(user.id, itemId, { client, now: NOW })).toBe(0);
  });
});
