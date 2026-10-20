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
import { ChatActionError, takeChatAction } from "./actions";
import { sendToJane } from "./typing";

// Spec step 185 against a real, migrated Postgres with the demo bank (and its stand-in
// money-movement partner): "cancel Hulu and put the savings in my emergency fund" is one
// plan, nothing runs before the one confirmation, the steps run in order through their
// features' own code, a failed step stops the rest and says why, and the transfer can be
// undone while it's pending.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone).
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

// Each test links and syncs a year of demo data, so they get more time than usual.
describe.runIf(url)(
  "requests that span sectors, against a real database",
  { timeout: 60_000 },
  () => {
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
    let tick = 0;
    const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);

    async function demoPerson(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      await client.savingsGoal.create({
        data: {
          userId: user.id,
          name: "Emergency fund",
          targetCents: 1_000_000,
          targetDate: new Date("2027-12-31T00:00:00Z"),
          manualSavedCents: 0,
        },
      });
      return user.id;
    }

    const huluFinding = (userId: string) =>
      client.finding.findFirstOrThrow({
        where: { userId, type: "subscription_review", title: { contains: "Hulu" } },
      });

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("shows one plan, runs nothing until the yes, then each step in order", async () => {
      const userId = await demoPerson("multi-run");
      const hulu = await huluFinding(userId);
      const { reply } = await sendToJane(
        userId,
        "Cancel Hulu and put the savings in my emergency fund",
        { client, now: later() },
      );
      const month = Math.round((hulu.annualSavingsCents ?? 0) / 12);
      const lines = reply.body.split("\n");
      expect(lines[0]).toBe("I can do both, in this order, once you say yes.");
      expect(lines[1]).toMatch(/^1\. Yes: .*Hulu/);
      expect(lines[2]).toMatch(/^2\. Move \$[\d,]+\.\d\d from .+ to your Emergency fund goal/);
      expect(reply.actions.map((a) => a.id)).toEqual(["multi.confirm", "multi.cancel"]);
      expect(reply.refs.multi?.steps[1]).toMatchObject({ kind: "transfer", amountCents: month });

      // Nothing ran before the confirmation.
      expect(await client.decision.count({ where: { userId } })).toBe(0);
      expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);

      const { message } = await takeChatAction(userId, reply.id, "multi.confirm", {
        client,
        now: later(),
      });
      expect(message.status).toBe("answered");
      expect(message.refs.note).toMatch(/^All done, in order\.\n1\. Done\. /);
      expect(
        await client.decision.findFirst({ where: { userId, findingId: hulu.id } }),
      ).toMatchObject({
        choice: "yes",
        source: "chat",
      });
      const transfer = await client.moneyTransfer.findFirstOrThrow({ where: { userId } });
      expect(transfer).toMatchObject({ amountCents: month, purpose: "goal", status: "pending" });
      expect(message.actions.map((a) => a.id)).toContain("multi.undo");

      // Undo, while it's pending.
      const { message: undone } = await takeChatAction(userId, reply.id, "multi.undo", {
        client,
        now: later(),
      });
      expect(undone.refs.note).toBe("Undone: the transfer won't happen.");
      expect(
        (await client.moneyTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status,
      ).toBe("cancelled");
    });

    it("stops at a step that fails, says why, and runs nothing after it", async () => {
      const userId = await demoPerson("multi-fail");
      const { reply } = await sendToJane(userId, "cancel Hulu and put $50 in my emergency fund", {
        client,
        now: later(),
      });
      expect(reply.actions[0].id).toBe("multi.confirm");
      // The finding changed since the plan was made: its Yes refuses, so the first step fails.
      const hulu = await huluFinding(userId);
      await client.finding.update({ where: { id: hulu.id }, data: { annualSavingsCents: 99_999 } });

      const { message } = await takeChatAction(userId, reply.id, "multi.confirm", {
        client,
        now: later(),
      });
      const lines = message.refs.note!.split("\n");
      expect(lines[0]).toBe("I stopped at the first step, so nothing changed.");
      expect(lines[1]).toMatch(/^1\. Didn't happen: /);
      expect(lines[2]).toBe("2. Not done, because the step before it failed.");
      expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
      expect(message.actions.map((a) => a.id)).not.toContain("multi.undo");
    });

    it("says which part it can't plan, and offers nothing to tap", async () => {
      const userId = await demoPerson("multi-no-goal");
      const { reply } = await sendToJane(userId, "cancel Hulu and put $50 in my boat goal", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^I can't do all of that as one plan: .*"boat"/);
      expect(reply.actions.some((a) => a.id === "multi.confirm")).toBe(false);
    });

    it("switches the car insurance and moves a month of the saving, as the spec asks", async () => {
      const userId = await demoPerson("multi-insurance");
      const { reply } = await sendToJane(
        userId,
        "Switch my car insurance and put the savings in my emergency fund.",
        { client, now: later() },
      );
      const lines = reply.body.split("\n");
      expect(lines[1]).toMatch(
        /^1\. Yes, switch: I found car insurance \$[\d,]+\.\d\d a year cheaper/,
      );
      const shop = await client.insuranceShop.findFirstOrThrow({
        where: {
          id:
            reply.refs.multi!.steps[0].kind === "chat"
              ? reply.refs.multi!.steps[0].refs.insuranceShopId
              : "",
        },
      });
      const month = Math.round((shop.savingCents ?? 0) / 12);
      expect(lines[2]).toContain(`Move $${(month / 100).toFixed(2)} from`);

      const { message } = await takeChatAction(userId, reply.id, "multi.confirm", {
        client,
        now: later(),
      });
      expect(message.refs.note).toMatch(/^All done, in order\.\n1\. Done\. I'm switching you now/);
      expect(await client.moneyTransfer.findFirst({ where: { userId } })).toMatchObject({
        amountCents: month,
      });
    });

    it("refuses another person's confirmation", async () => {
      const userId = await demoPerson("multi-mine");
      const other = await demoPerson("multi-other");
      const { reply } = await sendToJane(userId, "cancel Hulu and put $50 in my emergency fund", {
        client,
        now: later(),
      });
      await expect(
        takeChatAction(other, reply.id, "multi.confirm", { client, now: later() }),
      ).rejects.toBeInstanceOf(ChatActionError);
      expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
    });
    expect(message.refs.note).toMatch(/^All done, in order\.\n1\. Done\. I'm switching you now/);
    expect(await client.moneyTransfer.findFirst({ where: { userId } })).toMatchObject({
      amountCents: month,
    });
  });

  it("refuses another person's confirmation", async () => {
    const userId = await demoPerson("multi-mine");
    const other = await demoPerson("multi-other");
    const { reply } = await sendToJane(userId, "cancel Hulu and put $50 in my emergency fund", {
      client,
      now: later(),
    });
    await expect(
      takeChatAction(other, reply.id, "multi.confirm", { client, now: later() }),
    ).rejects.toBeInstanceOf(ChatActionError);
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
  });

  it("moves money to the savings account through the stand-in, and guides people without a partner", async () => {
    const userId = await demoPerson("multi-savings");
    const { reply } = await sendToJane(userId, "move $200 to savings", { client, now: later() });
    expect(reply.actions[0].id).toBe("multi.confirm");
    expect(reply.body).toMatch(/Move \$200\.00 from .+ to .*[Ss]avings/);
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
    await takeChatAction(userId, reply.id, "multi.confirm", { client, now: later() });
    expect(await client.moneyTransfer.findFirst({ where: { userId } })).toMatchObject({
      amountCents: 20_000,
      goalId: null,
      status: "pending",
    });

    // A real account (no money-movement partner): how to do it themselves, never a team request.
    const real = await client.user.create({
      data: { email: `multi-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking (CSV)",
        type: "depository",
        subtype: "checking",
      },
    });
    const guide = await sendToJane(real.id, "move $200 to savings", { client, now: later() });
    expect(guide.reply.body).toMatch(/^I can't move money in your bank yet/);
    expect(guide.reply.body).toContain("Once a money-movement partner is connected");
    expect(guide.reply.actions.map((a) => a.label)).toContain("Remind me tomorrow");
    expect(guide.reply.actions.some((a) => a.id === "multi.confirm")).toBe(false);
    expect(await client.moneyTransfer.count({ where: { userId: real.id } })).toBe(0);
  });
});
