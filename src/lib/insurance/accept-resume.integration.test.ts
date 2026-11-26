import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { acceptShop } from "./accept";
import { ensureDemoPolicies } from "./profile";
import { reshopPerson } from "./shop";

// A Yes whose agent never started is resumed on the next tap: one decision, one action.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("an accepted switch whose agent did not start", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("is resumed by the retried Yes, with no second decision", async () => {
    const user = await client.user.create({
      data: { email: `ins-resume-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await ensureDemoPolicies(user.id, { client, now: NOW });
    const [shop] = await reshopPerson(user.id, { client, now: NOW });
    const first = await acceptShop(user.id, shop.id, { client, now: NOW });
    // The start failed before it began: nothing marks the action as started.
    await client.action.update({
      where: { id: first.actionId },
      data: { agentState: null, replyToken: null },
    });

    const again = await acceptShop(user.id, shop.id, { client, now: NOW });
    expect(again.actionId).toBe(first.actionId);
    expect(again.decisionId).toBe(first.decisionId);
    expect(again.agentJobId).toBeTruthy();
    expect(await client.decision.count({ where: { userId: user.id } })).toBe(1);
    expect(await client.action.count({ where: { userId: user.id } })).toBe(1);
    // Started now, so a third tap is answered elsewhere.
    await expect(acceptShop(user.id, shop.id, { client, now: NOW })).rejects.toThrow(
      /already been answered/,
    );
  });

  async function stalledSwitch(quotePick: "runner-up" | "pick") {
    const user = await client.user.create({
      data: { email: `ins-resume-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await ensureDemoPolicies(user.id, { client, now: NOW });
    const [shop] = await reshopPerson(user.id, { client, now: NOW });
    const runnerUp = shop.runnersUp[0];
    const quoteId = quotePick === "runner-up" ? runnerUp?.id : undefined;
    const first = await acceptShop(user.id, shop.id, { client, now: NOW, quoteId });
    return { user, shop, runnerUp, first };
  }

  it("two retries of one tap start the switch once", async () => {
    const { user, shop, first } = await stalledSwitch("pick");
    await client.action.update({
      where: { id: first.actionId },
      data: { agentState: null, replyToken: null },
    });
    const results = await Promise.allSettled([
      acceptShop(user.id, shop.id, { client, now: NOW }),
      acceptShop(user.id, shop.id, { client, now: NOW }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("a resumed switch restores the quote the person picked when the shop write was lost", async () => {
    const { user, shop, runnerUp, first } = await stalledSwitch("runner-up");
    expect(runnerUp).toBeTruthy();
    // The decision was saved, but the shop write and the start were lost.
    await client.action.update({
      where: { id: first.actionId },
      data: { agentState: null, replyToken: null },
    });
    await client.insuranceShop.update({
      where: { id: shop.id },
      data: {
        status: "open",
        answeredAt: null,
        pick: shop.pick as never,
        runnersUp: shop.runnersUp as never,
        savingCents: shop.savingCents,
      },
    });
    await acceptShop(user.id, shop.id, { client, now: NOW });
    const after = await client.insuranceShop.findUniqueOrThrow({ where: { id: shop.id } });
    expect((after.pick as { id: string }).id).toBe(runnerUp.id);
    expect(after.status).toBe("accepted");
  });
});
