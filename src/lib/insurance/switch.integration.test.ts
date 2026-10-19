import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { agentStep } from "@/lib/agent/run";
import { logAudit } from "@/lib/audit";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { acceptShop } from "./accept";
import { demoPartner } from "./demo-partner";
import type { InsurancePartner } from "./partner";
import { ensureDemoPolicies } from "./profile";
import { reshopPerson } from "./shop";
import { confirmInsuranceSwitches } from "./switch";

// One-tap switch against a real, migrated Postgres (spec step 105): after the Yes, Jane binds
// the pick, waits for its first payment and only then cancels the old policy, from the new
// one's start day. A failed payment or no partner goes to the team with the old policy kept.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles. The demo policy renews in 40 days: Nov 28.
const NOW = new Date("2026-10-19T16:00:00Z");
const START = new Date("2026-11-28T16:00:00Z");
const notify = vi.fn(async () => {});

describe.runIf(url)("the insurance switch, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  // A demo-bank person who said Yes to Jane's pick, with the agent's first step run.
  async function switching(partner: InsurancePartner | null = demoPartner) {
    const user = await client.user.create({
      data: { email: `ins-sw-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
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
    const old = await client.insurancePolicy.findFirstOrThrow({ where: { userId: user.id } });
    const [shop] = await reshopPerson(user.id, { client, now: NOW });
    const { actionId } = await acceptShop(user.id, shop.id, { client, now: NOW });
    if (partner === demoPartner) {
      await agentStep(user.id, actionId, { client, now: NOW, notify });
    } else {
      const { startInsuranceSwitch } = await import("./switch");
      const { loadAction } = await import("@/lib/agent/run");
      await startInsuranceSwitch(user.id, (await loadAction(user.id, actionId, client))!, {
        client,
        now: NOW,
        notify,
        partner,
      });
    }
    return { userId: user.id, actionId, oldId: old.id };
  }
  const policies = (userId: string) =>
    client.insurancePolicy.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  beforeAll(() => {
    // The declarations page is kept encrypted, like any document.
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("binds the pick to start when the old policy renews, keeps its documents, and keeps the old one", async () => {
    const { userId, actionId, oldId } = await switching();
    const [old, fresh] = await policies(userId);
    expect(old).toMatchObject({ id: oldId, status: "active", cancelledAt: null });
    expect(fresh).toMatchObject({
      carrier: "Lighthouse Insurance (demo)",
      status: "pending",
      source: "switch",
      premiumCents: 10_800,
      replacesPolicyId: oldId,
      actionId,
    });
    expect(fresh.policyNumber).toMatch(/^DEMO-LIGHTHOUSE-/);
    expect(fresh.startsOn?.toISOString().slice(0, 10)).toBe("2026-11-28");
    expect(fresh.renewalDate?.toISOString().slice(0, 10)).toBe("2027-11-28");
    const document = await client.document.findUniqueOrThrow({ where: { id: fresh.documentId! } });
    expect(document).toMatchObject({
      kind: "insurance_policy",
      contentType: "application/pdf",
      provider: "Lighthouse Insurance (demo)",
      extractionSource: "partner",
    });
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
    expect(action).toMatchObject({
      status: "in_progress",
      agentState: "switching",
      userTodo: null,
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "insurance_policy_bound",
      { type: "insurance_policy", id: fresh.id },
      expect.objectContaining({ action_id: actionId }),
    );

    // Before the start day the first payment isn't taken: nothing is cancelled.
    expect(await confirmInsuranceSwitches({ client, now: NOW, notify, userId })).toEqual({
      switched: 0,
      handedOff: 0,
    });
    expect((await policies(userId))[0].status).toBe("active");

    // In the chat: what Jane did, once, and the answer to "how's my switch going".
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const messages = await client.janeMessage.findMany({ where: { userId } });
    expect(messages.find((m) => m.dedupeKey === `insurance:bound:${fresh.id}`)?.body).toBe(
      "I've bought your new Lighthouse Insurance (demo) car insurance, starting Nov 28. GEICO stays in place until its first payment goes through; then I cancel it from the same day, so you're never without cover.",
    );
    const { reply } = await sendToJane(userId, "how's my insurance switch going", {
      client,
      now: NOW,
    });
    expect(reply.body).toMatch(
      /^I bought your new Lighthouse Insurance \(demo\) car insurance, starting Nov 28, 2026\./,
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "insurance_policies", {}, { client, now: NOW })).content,
    );
    expect(tool.switches[0]).toMatchObject({ replaces: "GEICO", startsOn: "2026-11-28" });
  });

  it("cancels the old policy only once the first payment went through, from the start day", async () => {
    const { userId, actionId, oldId } = await switching();
    expect(await confirmInsuranceSwitches({ client, now: START, notify, userId })).toEqual({
      switched: 1,
      handedOff: 0,
    });
    const [old, fresh] = await policies(userId);
    expect(fresh.status).toBe("active");
    expect(old).toMatchObject({ id: oldId, status: "cancelled" });
    expect(old.cancelledAt).not.toBeNull();
    const action = await client.action.findUniqueOrThrow({
      where: { id: actionId },
      include: { agentMessages: { orderBy: { createdAt: "asc" } } },
    });
    expect(action).toMatchObject({
      status: "done",
      agentState: "finished",
      confirmedAnnualCents: 40_800,
    });
    expect(action.agentMessages.at(-1)?.body).toMatch(
      /^First payment to Lighthouse Insurance \(demo\) went through: your new policy is active\. Cancelled GEICO from Nov 28/,
    );
    // Never twice.
    expect(await confirmInsuranceSwitches({ client, now: START, notify, userId })).toEqual({
      switched: 0,
      handedOff: 0,
    });
    await runJaneAgent(userId, { client, now: START, trigger: "open" });
    const done = (await client.janeMessage.findMany({ where: { userId } })).find((m) =>
      m.dedupeKey.startsWith("insurance:switched:"),
    );
    expect(done?.body).toBe(
      "Your switch is done: the first payment to Lighthouse Insurance (demo) went through, so your new car insurance is in place and I cancelled GEICO from Nov 28. No gap in cover.",
    );
    expect(parseRefs(done?.refs).actionId).toBe(actionId);
  });

  it("keeps the old policy and hands it to the team when the first payment fails", async () => {
    const failing: InsurancePartner = { ...demoPartner, paymentStatus: async () => "failed" };
    const { userId, actionId, oldId } = await switching(failing);
    expect(
      await confirmInsuranceSwitches({ client, now: START, notify, userId, partner: failing }),
    ).toEqual({ switched: 0, handedOff: 1 });
    const [old, fresh] = await policies(userId);
    expect(old).toMatchObject({ id: oldId, status: "active", cancelledAt: null });
    expect(fresh.status).toBe("removed");
    expect(await client.action.findUniqueOrThrow({ where: { id: actionId } })).toMatchObject({
      agentState: "handed_off",
      status: "queued",
    });
  });

  it("hands it to the team when no partner can bind, without touching the old policy", async () => {
    const { userId, actionId } = await switching(null);
    expect(await policies(userId)).toHaveLength(1);
    expect((await policies(userId))[0].status).toBe("active");
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
    expect(action.agentState).toBe("handed_off");
    expect(action.handoffReason).toMatch(/Keep GEICO until the new policy is paid/);
  });
});
