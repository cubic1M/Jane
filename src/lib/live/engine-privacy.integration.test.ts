import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { LIVE_MATCHES_PER_RUN } from "@/config/detection";
import { TRIAL_HOURS, TRIAL_ID_PREFIX } from "@/config/trial";
import { encrypt } from "@/lib/crypto";
import { removePlaidItem } from "@/lib/plaid/remove";
import { cleanUpTrials } from "@/lib/trial";
import { recordArrivals } from "./arrivals";
import { matchOffers, refreshWatches } from "./watches";

// The 24/7 engine's rows, test pass 11-13: reverse matching takes LIVE_MATCHES_PER_RUN people a
// run and reaches every one exactly once; and once a bank is removed or a sample person's time is
// up, none of what the engine kept about them is left (offer_watches, finding_arrivals, the chat
// message it posted and the notification it queued).

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
// Far past every other file's made-up offers (they run out a day after 2026-11-12), so the only
// live offers this file's matching sees are its own.
const LATER = new Date("2027-06-01T18:00:00Z");
const SERVICE = `privfm${randomBytes(6)
  .toString("hex")
  .replace(/[^a-f]/g, "")
  .slice(0, 8)}x`;
const STUDENT = `plan.${SERVICE}.student`;

describe.runIf(url)("the 24/7 engine's rows", () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.marketOffer.deleteMany({ where: { key: STUDENT } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(id?: string) {
    const user = await client.user.create({
      data: {
        ...(id ? { id } : {}),
        email: `priv-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    made.push(user.id);
    return user.id;
  }
  // A full-price charge for this file's service, from an account that's part of a bank or not.
  async function paysFullPrice(userId: string, accountId?: string) {
    const key = `merchant:${SERVICE}`;
    await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key,
        title: `Review your ${SERVICE} subscription`,
        annualSavingsCents: 48_000,
        amountCents: 48_000,
        confidence: "high",
        evidence: {
          merchant: SERVICE,
          lastAmountCents: 1_299,
          ...(accountId ? { accountId } : {}),
        },
      },
    });
    return { type: "subscription_review" as const, key };
  }

  it(`reaches every person a moved offer helps, ${LIVE_MATCHES_PER_RUN} a run, each once`, async () => {
    const people: string[] = [];
    for (let i = 0; i < LIVE_MATCHES_PER_RUN + 3; i++) {
      const userId = await person();
      await paysFullPrice(userId);
      await refreshWatches(userId, { client });
      people.push(userId);
    }
    const data = {
      source: "test",
      kind: "plan_price",
      provider: "Test",
      name: STUDENT,
      valueCents: 699,
      merchantKey: SERVICE,
      sourceUrl: "https://example.com/",
      checkedAt: LATER,
      expiresAt: new Date(LATER.getTime() + 24 * HOUR),
      extractedBy: "parser",
    };
    await client.marketOffer.upsert({
      where: { key: STUDENT },
      create: { key: STUDENT, ...data },
      update: data,
    });
    const scanned: string[] = [];
    const scan = vi.fn(async (userId: string) => {
      scanned.push(userId);
    });
    const runs: number[] = [];
    for (let run = 0; run < 5; run++) {
      const { matched } = await matchOffers({ client, now: LATER, scan });
      runs.push(matched);
      if (matched === 0) break;
    }
    expect(runs[0]).toBe(LIVE_MATCHES_PER_RUN);
    expect(runs.every((n) => n <= LIVE_MATCHES_PER_RUN)).toBe(true);
    const mine = scanned.filter((id) => people.includes(id));
    expect(new Set(mine).size).toBe(people.length);
    expect(mine).toHaveLength(people.length);
  });

  it("leaves nothing of the engine's once a bank is removed", async () => {
    const userId = await person();
    const suffix = randomBytes(6).toString("hex");
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${suffix}`,
        accessTokenEncrypted: encrypt(`access-sandbox-${suffix}`),
      },
    });
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `acc-${suffix}`,
        name: "Checking",
        type: "depository",
      },
    });
    const created = await paysFullPrice(userId, account.id);
    // 10am in Los Angeles: told now, so there's a message and a queued notification.
    const at = new Date("2026-11-13T18:00:00Z");
    await recordArrivals(userId, [created], { client, now: at, trigger: "webhook", triggerAt: at });
    await refreshWatches(userId, { client });
    expect(await client.findingArrival.count({ where: { userId } })).toBe(1);
    expect(await client.offerWatch.count({ where: { userId } })).toBe(1);
    expect(await client.janeMessage.count({ where: { userId, status: "open" } })).toBe(1);

    const api = { itemRemove: vi.fn(async () => ({ data: {} })) } as unknown as PlaidApi;
    await removePlaidItem(userId, item.id, "user_disconnected", { client, api });
    // Without waiting on the rescan that follows a disconnect (it runs after the response).
    expect(await client.findingArrival.count({ where: { userId } })).toBe(0);
    expect(await client.offerWatch.count({ where: { userId } })).toBe(0);
    // The card it posted is put away, so the queued notification has nothing to send.
    expect(await client.janeMessage.count({ where: { userId, status: "open" } })).toBe(0);
  });

  it("leaves nothing of the engine's once a sample person's time is up", async () => {
    const userId = await person(`${TRIAL_ID_PREFIX}${crypto.randomUUID()}`);
    const created = await paysFullPrice(userId);
    const at = new Date();
    await recordArrivals(userId, [created], { client, now: at, trigger: "sync", triggerAt: at });
    await refreshWatches(userId, { client });
    expect(await client.findingArrival.findMany({ where: { userId } })).toMatchObject([
      { notice: "sample" },
    ]);
    // A sample person never gets a watch, a message from the engine or a notification.
    expect(await client.offerWatch.count({ where: { userId } })).toBe(0);
    expect(await client.janeMessage.count({ where: { userId } })).toBe(0);

    await client.user.update({
      where: { id: userId },
      data: { createdAt: new Date(at.getTime() - (TRIAL_HOURS + 1) * HOUR) },
    });
    expect(await cleanUpTrials({ client, userIds: [userId] })).toBe(1);
    expect(await client.findingArrival.count({ where: { userId } })).toBe(0);
    expect(await client.offerWatch.count({ where: { userId } })).toBe(0);
    expect(
      await client.job.count({ where: { kind: "chat_notify", payload: { equals: { userId } } } }),
    ).toBe(0);
  });
});
