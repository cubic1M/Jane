import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { planFor, planOnceCents, planTotalCents } from "@/lib/plan";
import { yearlyAndOnce } from "@/lib/report-state";
import { AS_THEY_COME } from "./preferences";
import { runJaneAgent } from "./run";
import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// Debugger 11-13, a new student's first minutes: the week's plan card, posted by the first scan's
// early run, said "22 things, worth up to $3,560.81 a year" while Home and /plan said 23 and
// $3,720.81 once the slower work had added a $160 phone-bill item. The card is said from the plan
// as it is now, and goes once there's nothing on it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the week's plan card", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  const planCard = async () => {
    const rows = await client.janeMessage.findMany({
      where: { userId, status: "open", body: { startsWith: "Your plan for this week" } },
      select: MESSAGE_SELECT,
    });
    return rows.map(toChatMessage);
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `plan-card-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await runJaneAgent(userId, { client, now: LINKED, trigger: "open" });
  }, 240_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("says the plan as it is now after an item joins it, and goes once it's empty", async () => {
    const [card] = await planCard();
    expect(card).toBeDefined();
    const before = await planFor(userId, { client });
    expect(card!.body).toContain(`${before.length} things`);

    // The slower work adds one more item after the card was posted.
    await client.finding.create({
      data: {
        userId,
        type: "bill_negotiation",
        key: "plan-card-as-now:phone",
        title: "Your phone bill is above the typical price",
        annualSavingsCents: 16_000,
        confidence: "medium",
      },
    });
    const after = await planFor(userId, { client });
    expect(after.length).toBe(before.length + 1);
    const [shown] = await stillTrue(userId, [card!], { client, now: LINKED });
    expect(shown!.body).toContain(`${after.length} things`);
    expect(shown!.body).toContain(
      yearlyAndOnce({ cents: planTotalCents(after), onceCents: planOnceCents(after) }),
    );
    expect(shown!.body).not.toContain(`${before.length} things`);

    // Everything on it dealt with: the card goes.
    await client.finding.updateMany({ where: { userId }, data: { status: "declined" } });
    expect(await stillTrue(userId, [card!], { client, now: LINKED })).toEqual([]);
  });
});
