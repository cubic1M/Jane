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
import { parseRefs } from "@/lib/jane-agent/types";
import { checkupAll, checkupDue, checkupPerson, latestCheckup } from "./checkups";
import { EMPTY_POLICY_INPUT, addPolicy } from "./policies";
import { ensureDemoPolicies } from "./profile";

// The coverage checkup against a real, migrated Postgres (spec step 106): once a year by
// itself, after a life event, and when asked, for demo advice only; in the chat with Got it.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles.
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("the coverage checkup against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  // The demo bank's GEICO policy and $12,000 in savings: its $1,000 deductible could go up.
  async function demoPerson(savingsCents = 1_200_000) {
    const user = await client.user.create({
      data: { email: `ins-ck-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await client.account.createMany({
      data: [
        {
          userId: user.id,
          source: "plaid",
          name: "Checking",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 300_000,
        },
        {
          userId: user.id,
          source: "plaid",
          name: "Savings",
          type: "depository",
          subtype: "savings",
          currentBalanceCents: savingsCents,
        },
      ],
    });
    await ensureDemoPolicies(user.id, { client, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("runs by itself once a year, and again after a life event", async () => {
    const userId = await demoPerson();
    const first = await checkupPerson(userId, { client, now: NOW });
    expect(first?.reason).toBe("yearly");
    // Its $50,000 injury cover is low too.
    expect(first?.recommendations.map((r) => r.key)).toEqual(["deductible_up", "liability_up"]);
    expect(first?.recommendations[0]).toMatchObject({
      cost: "Saves about $189.33 a year",
      risk: expect.stringMatching(/^On a claim you'd pay up to \$1,500\.00 more yourself/),
    });
    // Not again within the year.
    expect(
      await checkupDue(userId, { client, now: new Date(NOW.getTime() + 200 * DAY) }),
    ).toBeNull();
    expect(
      (await checkupDue(userId, { client, now: new Date(NOW.getTime() + 366 * DAY) }))?.reason,
    ).toBe("yearly");

    // A new baby (spec step 100): checked again, and life cover recommended.
    await client.lifeEvent.create({
      data: {
        userId,
        kind: "new_baby",
        startedOn: new Date("2026-10-20T00:00:00Z"),
        createdAt: new Date(NOW.getTime() + DAY / 2),
      },
    });
    const after = await checkupPerson(userId, { client, now: new Date(NOW.getTime() + DAY) });
    expect(after?.reason).toBe("life_event");
    expect(after?.recommendations.map((r) => r.key)).toContain("life_after_baby");
    expect(
      await checkupPerson(userId, { client, now: new Date(NOW.getTime() + 2 * DAY) }),
    ).toBeNull();
  });

  it("never runs for a real account, and the daily run reaches everyone due", async () => {
    const real = await client.user.create({
      data: { email: `ins-ck-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await addPolicy(real.id, { ...EMPTY_POLICY_INPUT, kind: "auto", carrier: "GEICO" }, { client });
    expect(await checkupPerson(real.id, { client, now: NOW })).toBeNull();
    const demo = await demoPerson();
    const run = await checkupAll({ client, now: NOW });
    expect(run.checkups).toBeGreaterThanOrEqual(1);
    expect(await latestCheckup(demo, { client })).not.toBeNull();
    expect(await latestCheckup(real.id, { client })).toBeNull();
  });

  it("says what it found in the chat once, labelled, and Got it marks it seen", async () => {
    const userId = await demoPerson();
    await checkupPerson(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId } })).find(
      (m) => parseRefs(m.refs).insuranceCheckupId,
    );
    expect(message?.kind).toBe("heads_up");
    expect(message?.body.split("\n")[0]).toBe(
      "I checked your insurance for the year. 2 things are worth a look:",
    );
    expect(parseRefs(message?.refs).advice).toBe(true);
    const { message: answered } = await takeChatAction(
      userId,
      message!.id,
      "insurance.checkup_seen",
      {
        client,
        now: NOW,
      },
    );
    expect(answered.answeredWith).toBe("Got it");
    expect((await latestCheckup(userId, { client }))?.seenAt).not.toBeNull();

    const tool = JSON.parse(
      (await runChatTool(userId, "insurance_checkup", {}, { client, now: NOW })).content,
    );
    expect(tool.recommendations[0]).toMatchObject({ cost: "Saves about $189.33 a year" });
  });

  it("checks when asked, and explains why it doesn't for a real account", async () => {
    const userId = await demoPerson(60_000);
    const { reply } = await sendToJane(userId, "check my insurance", { client, now: NOW });
    expect(reply.body).toMatch(
      /^I checked your insurance as you asked\. 2 things are worth a look:\n- Lower the deductible/,
    );
    expect(reply.refs.advice).toBe(true);

    const real = await client.user.create({
      data: { email: `ins-ck-ask-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const { reply: plain } = await sendToJane(real.id, "am I over-insured", { client, now: NOW });
    expect(plain.body).toMatch(
      /^Checking whether you have the right amount of cover means recommending changes/,
    );
    expect(plain.refs.advice).toBeUndefined();
  });
});
