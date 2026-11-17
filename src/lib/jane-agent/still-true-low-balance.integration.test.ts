import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox, checking + student and car loans): Plaid's
// first sync brings 30 days, so the first scan raised "Plaid checking could drop to -$427.25
// around Dec 18 if no pay comes in" (no paycheck pattern yet). Refresh now brought four months,
// the paychecks came into the forecast and the low-balance finding went, and Money said "Lowest
// point about $658.94 on Dec 9", but the dock kept the alert. It holds while its account's
// low-balance finding does.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T19:00:00Z");

describe.runIf(url)("a low-balance alert in the dock", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  let accountId = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const email = "still-true-low-balance@example.com";
    await client.user.deleteMany({ where: { email } });
    userId = (await client.user.create({ data: { email } })).id;
    accountId = (
      await client.account.create({
        data: { userId, source: "plaid", name: "Plaid checking", type: "depository" },
      })
    ).id;
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  async function card(month: string) {
    const title = `Plaid checking could drop to -$427.25 around ${month === "2026-12" ? "Dec 18" : "Jan 18"} if no pay comes in`;
    const alert = await client.alert.create({
      data: {
        userId,
        type: "low_balance",
        key: `account:${accountId}:${month}`,
        title,
        body: "That's from your balance today and the bills due before your next deposit.",
        urgent: true,
        createdAt: NOW,
      },
    });
    const row = await client.janeMessage.create({
      data: {
        userId,
        kind: "heads_up",
        body: `${title}. That's from your balance today and the bills due before your next deposit.`,
        refs: { alertId: alert.id },
        actions: [{ id: "alert.got_it", label: "Got it", kind: "primary" }],
        dedupeKey: `heads_ups:alert:${alert.id}`,
        createdAt: NOW,
      },
      select: MESSAGE_SELECT,
    });
    return toChatMessage(row);
  }

  it("is put away once the account's forecast no longer dips", async () => {
    const message = await card("2026-12");
    expect(await stillTrue(userId, [message], { client, now: NOW })).toEqual([]);
  });

  it("stays while the low-balance finding does", async () => {
    await client.finding.create({
      data: {
        userId,
        type: "low_balance_risk",
        key: `account:${accountId}`,
        title: "Plaid checking could drop to -$427.25 around Jan 18",
        confidence: "low",
      },
    });
    const message = await card("2027-01");
    expect((await stillTrue(userId, [message], { client, now: NOW })).map((m) => m.id)).toEqual([
      message.id,
    ]);
  });
});
