import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { AcceptShopError, acceptShop, insuranceSwitchOf } from "./accept";
import { EMPTY_POLICY_INPUT, addPolicy, updatePolicy } from "./policies";
import { ensureDemoPolicies } from "./profile";
import { declineShop, openShops, reshopAll, reshopPerson, shopById } from "./shop";

// Shopped for you against a real, migrated Postgres (spec step 104): reshops run by
// themselves before renewal and on a price rise, Jane's pick is asked about once in the
// chat, and nothing is bought without the Yes.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles: after quiet hours.
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("insurance shopped for you, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-shop-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    // An account, so Jane talks to them.
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return user.id;
  }
  // The demo bank's GEICO policy, renewing in 40 days.
  async function demoPerson() {
    const userId = await person();
    await ensureDemoPolicies(userId, { client, now: NOW });
    const policy = await client.insurancePolicy.findFirstOrThrow({ where: { userId } });
    return { userId, policyId: policy.id };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reshops by itself before renewal, once, and keeps Jane's pick", async () => {
    const { userId, policyId } = await demoPerson();
    // 50 days out: not yet.
    expect(await reshopPerson(userId, { client, now: new Date(NOW.getTime() - 10 * DAY) })).toEqual(
      [],
    );
    const [shop] = await reshopPerson(userId, { client, now: NOW });
    expect(shop).toMatchObject({
      policyId,
      reason: "renewal",
      status: "open",
      savingCents: 40_800,
      currentAnnualCents: 170_400,
      quoteCount: 4,
      demo: true,
    });
    expect(shop.pick?.carrier.name).toBe("Lighthouse Insurance (demo)");
    expect(shop.runnersUp.map((q) => q.carrier.name)).toEqual(["Bluepeak Mutual (demo)"]);
    expect(shop.why).toHaveLength(3);
    // The same renewal is never shopped twice.
    expect(await reshopPerson(userId, { client, now: new Date(NOW.getTime() + DAY) })).toEqual([]);
  });

  it("reshops when the price goes up, from the policy or from a charge", async () => {
    const { userId, policyId } = await demoPerson();
    // Long before renewal, so only a rise counts.
    const early = new Date(NOW.getTime() - 200 * DAY);
    await reshopPerson(userId, { client, now: NOW });
    await updatePolicy(
      userId,
      policyId,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "auto",
        carrier: "GEICO",
        premium: "160",
        premiumFrequency: "monthly",
        deductible: "1000",
        renewalDate: "2027-09-01",
        coverage: {
          bodilyInjuryPerPerson: "50000",
          bodilyInjuryPerAccident: "100000",
          propertyDamage: "50000",
          collision: "yes",
          comprehensive: "yes",
          uninsuredMotorist: "yes",
        },
      },
      { client },
    );
    const [raised] = await reshopPerson(userId, { client, now: early });
    expect(raised).toMatchObject({ reason: "price_up", currentAnnualCents: 192_000 });

    // A GEICO charge above the price on file.
    const other = await demoPerson();
    const account = await client.account.findFirstOrThrow({ where: { userId: other.userId } });
    await client.insurancePolicy.update({
      where: { id: other.policyId },
      data: { renewalDate: new Date("2027-09-01T00:00:00Z") },
    });
    await client.transaction.create({
      data: {
        userId: other.userId,
        accountId: account.id,
        source: "plaid",
        date: new Date("2026-10-02T00:00:00Z"),
        amountCents: 15_800,
        description: "GEICO *AUTO",
        merchantName: "GEICO",
      },
    });
    const [charged] = await reshopPerson(other.userId, { client, now: NOW });
    expect(charged).toMatchObject({ reason: "price_up" });
  });

  it("never shops for a real account, and the daily run expires old picks", async () => {
    const real = await person(false);
    await addPolicy(
      real,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "auto",
        carrier: "GEICO",
        premium: "142",
        premiumFrequency: "monthly",
        renewalDate: "2026-11-01",
      },
      { client },
    );
    expect(await reshopPerson(real, { client, now: NOW })).toEqual([]);

    const { userId } = await demoPerson();
    const [shop] = await reshopPerson(userId, { client, now: NOW });
    await reshopAll({ client, now: new Date(NOW.getTime() + 31 * DAY) });
    expect((await shopById(userId, shop.id, { client }))?.status).toBe("expired");
  });

  it("Yes records the switch as a decision and an action; Not now keeps the policy", async () => {
    const { userId, policyId } = await demoPerson();
    const [shop] = await reshopPerson(userId, { client, now: NOW });
    const { actionId, decisionId } = await acceptShop(userId, shop.id, { client, now: NOW });
    const decision = await client.decision.findUniqueOrThrow({
      where: { id: decisionId },
      include: { finding: true, action: true },
    });
    expect(decision).toMatchObject({ choice: "yes", source: "chat" });
    expect(decision.action?.id).toBe(actionId);
    expect(decision.action?.type).toBe("insurance_reshop");
    expect(decision.finding).toMatchObject({
      type: "insurance_reshop",
      status: "approved",
      annualSavingsCents: 40_800,
    });
    expect(insuranceSwitchOf(decision.options)).toMatchObject({
      insuranceShopId: shop.id,
      insurancePolicyId: policyId,
      insuranceCarrier: "Lighthouse Insurance (demo)",
      insuranceAnnualCents: 129_600,
    });
    expect((await shopById(userId, shop.id, { client }))?.status).toBe("accepted");
    await expect(acceptShop(userId, shop.id, { client, now: NOW })).rejects.toBeInstanceOf(
      AcceptShopError,
    );

    const next = await demoPerson();
    const [kept] = await reshopPerson(next.userId, { client, now: NOW });
    expect(await declineShop(next.userId, kept.id, { client, now: NOW })).toBe(true);
    expect(await declineShop(next.userId, kept.id, { client, now: NOW })).toBe(false);
    expect(await openShops(next.userId, { client, now: NOW })).toEqual([]);
    // Someone else can't answer it.
    await expect(acceptShop(userId, kept.id, { client, now: NOW })).rejects.toBeInstanceOf(
      AcceptShopError,
    );
  });

  it("asks about Jane's pick once in the chat, and Yes there is the one tap", async () => {
    const { userId } = await demoPerson();
    await reshopPerson(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const messages = await client.janeMessage.findMany({ where: { userId } });
    const asked = messages.find((m) => parseRefs(m.refs).insuranceShopId);
    expect(asked?.kind).toBe("decision");
    expect(asked?.body.split("\n")[0]).toBe(
      "I found car insurance $408.00 a year cheaper for the same cover: Lighthouse Insurance (demo), at $108.00 a month.",
    );
    expect(parseRefs(asked?.refs).advice).toBe(true);
    expect(parseActions(asked?.actions).map((a) => a.label)).toEqual([
      "Yes, switch",
      "Show options",
      "Not now",
    ]);
    const { message } = await takeChatAction(userId, asked!.id, "insurance.shop_yes", {
      client,
      now: NOW,
    });
    expect(message).toMatchObject({ status: "answered", answeredWith: "Yes, switch" });
    expect(await client.action.count({ where: { userId, type: "insurance_reshop" } })).toBe(1);

    const tool = JSON.parse(
      (await runChatTool(userId, "insurance_quotes", {}, { client, now: NOW })).content,
    );
    // Answered: no open pick left to describe.
    expect(tool.policies[0].janesPick).toBeNull();
  });

  it("finds a cheaper policy when asked, with Yes and Not now", async () => {
    const { userId } = await demoPerson();
    const { reply } = await sendToJane(userId, "find me cheaper car insurance", {
      client,
      now: NOW,
    });
    expect(reply.body).toMatch(/^I found car insurance \$408\.00 a year cheaper/);
    expect(reply.refs.advice).toBe(true);
    expect(reply.actions.map((a) => a.id)).toEqual([
      "insurance.shop_yes",
      "open",
      "insurance.shop_no",
    ]);
    const { message } = await takeChatAction(userId, reply.id, "insurance.shop_no", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toMatch(/^OK, you'll keep your current policy/);
  });
});
