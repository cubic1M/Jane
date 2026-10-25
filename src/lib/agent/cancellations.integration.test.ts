import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import {
  agentStep,
  confirmCancellations,
  confirmDate,
  markSelfCancelled,
  refundChargesAfterCancel,
} from "./run";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.runIf(url)("cancellations by the agent, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const merchantKeys: string[] = [];
  const notify = vi.fn(async () => undefined);

  async function person() {
    const user = await client.user.create({
      data: { email: `cancel-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Card",
        type: "credit",
        subtype: "credit card",
      },
    });
    return { userId: user.id, accountId: account.id };
  }

  // A merchant only cancellable from the account holder's page.
  async function pageOnlyMerchant() {
    // Letters only (they survive normalization), random enough never to repeat.
    const name = `Pageonly${Array.from({ length: 14 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}`;
    const key = name.toLowerCase();
    merchantKeys.push(key);
    await client.merchant.create({
      data: { key, name, cancelUrl: `https://${key}.example/cancel` },
    });
    return name;
  }

  async function approve(
    userId: string,
    type: "subscription_review" | "charge_after_cancel",
    merchant: string,
    options?: Record<string, unknown>,
  ) {
    const finding = await client.finding.create({
      data: {
        userId,
        type,
        key: `merchant:${merchant.toLowerCase()}-${crypto.randomUUID()}`,
        title: `Review your ${merchant} subscription`,
        annualSavingsCents: 18_588,
        amountCents: 1_549,
        confidence: "high",
        evidence: {
          merchant,
          frequency: "MONTHLY",
          lastAmountCents: 1_549,
          charges: [{ date: "2026-10-14", amountCents: 1_549 }],
        } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    // A charge after a cancellation isn't approved here: Jane does that on its own.
    if (type === "charge_after_cancel") return { findingId: finding.id, actionId: "" };
    const { actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)), options },
      { client },
    );
    return { findingId: finding.id, actionId: actionId! };
  }

  const reload = (id: string) => client.action.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.merchant.deleteMany({ where: { key: { in: merchantKeys } } });
    await client.$disconnect();
  });

  it("works out when a missed charge confirms a cancellation", () => {
    const evidence = { frequency: "MONTHLY", charges: [{ date: "2026-10-14" }] };
    // Next charge due Nov 13 (30 days), plus 5 days' grace.
    expect(confirmDate(evidence, new Date("2026-10-20T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-11-18",
    );
    // Unknown frequency: 35 days from cancelling, plus grace.
    expect(confirmDate({}, new Date("2026-10-20T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-11-29",
    );
  });

  it("emails a cancellation, and asks for a downgrade when that's what the person chose", async () => {
    const { userId } = await person();
    const { actionId } = await approve(userId, "subscription_review", "Streamwise", {
      plan: "downgrade",
    });
    expect(await agentStep(userId, actionId, { client, notify })).toBe("sent");
    const sent = await client.agentMessage.findFirstOrThrow({ where: { actionId } });
    expect(sent.body).toContain("cheapest plan");
  });

  it("gives the person the company's cancel page, then confirms by a missed charge", async () => {
    const { userId } = await person();
    const merchant = await pageOnlyMerchant();
    const { actionId } = await approve(userId, "subscription_review", merchant);
    expect(await agentStep(userId, actionId, { client, notify })).toBe("waiting");
    const waiting = await reload(actionId);
    expect(waiting).toMatchObject({
      status: "waiting_on_user",
      agentState: "confirming",
      selfServiceUrl: `https://${merchant.toLowerCase()}.example/cancel`,
    });
    expect(await client.agentMessage.count({ where: { actionId, direction: "outbound" } })).toBe(0);

    const today = new Date();
    await markSelfCancelled(userId, actionId, { client, now: today });
    const confirming = await reload(actionId);
    expect(confirming.status).toBe("in_progress");
    expect(confirming.confirmAfter).not.toBeNull();

    // Not yet: the next charge isn't due.
    expect(await confirmCancellations({ client, now: today, notify })).toMatchObject({
      confirmed: 0,
    });
    const later = new Date(confirming.confirmAfter!.getTime() + DAY);
    await confirmCancellations({ client, now: later, notify });
    expect(await reload(actionId)).toMatchObject({ status: "done", agentState: "finished" });
  });

  it("questions a cancellation when the company charges again", async () => {
    const { userId, accountId } = await person();
    const merchant = await pageOnlyMerchant();
    const { actionId } = await approve(userId, "subscription_review", merchant);
    await agentStep(userId, actionId, { client, notify });
    await markSelfCancelled(userId, actionId, { client });
    await client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date(Date.now() + 3 * DAY),
        amountCents: 1_549,
        description: merchant.toUpperCase(),
      },
    });
    const confirming = await reload(actionId);
    await confirmCancellations({
      client,
      now: new Date(confirming.confirmAfter!.getTime() + DAY),
      notify,
    });
    const questioned = await reload(actionId);
    expect(questioned).toMatchObject({ status: "waiting_on_user", agentState: "handed_off" });
    expect(questioned.userTodo).toContain("charged you again");
  });

  it("hands a card dispute to the team instead of emailing the merchant", async () => {
    const { userId } = await person();
    const finding = await client.finding.create({
      data: {
        userId,
        type: "duplicate_charge",
        key: crypto.randomUUID(),
        title: "Charged twice? $64.20 at Target",
        annualSavingsCents: 6_420,
        amountCents: 6_420,
        confidence: "medium",
        evidence: { merchant: "Target", charges: [] } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      userId,
      {
        findingId: finding.id,
        choice: "yes",
        cardHash: cardHash(buildCard(finding)),
        options: { method: "dispute" },
      },
      { client },
    );
    expect(await agentStep(userId, actionId!, { client, notify })).toBe("handed_off");
    expect((await reload(actionId!)).handoffReason).toContain("dispute");
  });

  it("asks for a refund on its own when a company charges after a cancellation", async () => {
    const { userId } = await person();
    const { findingId } = await approve(userId, "charge_after_cancel", "Streamwise");
    const [decisionId] = await refundChargesAfterCancel(userId, { client });
    const decision = await client.decision.findUniqueOrThrow({
      where: { id: decisionId },
      include: { action: true },
    });
    expect(decision).toMatchObject({
      findingId,
      choice: "yes",
      source: "auto",
      ruleKey: "charge_after_cancel",
    });
    expect(decision.action).toMatchObject({ type: "request_refund", agentState: "working" });
    expect(await refundChargesAfterCancel(userId, { client })).toEqual([]);
  });

  it("confirms a cancellation the person never told Jane about, by the missing charge", async () => {
    const { userId } = await person();
    const merchant = await pageOnlyMerchant();
    const { actionId } = await approve(userId, "subscription_review", merchant);
    await agentStep(userId, actionId, { client, notify });
    const offered = await reload(actionId);
    expect(offered.confirmAfter).not.toBeNull();
    await confirmCancellations({
      client,
      now: new Date(offered.confirmAfter!.getTime() + DAY),
      notify,
    });
    expect(await reload(actionId)).toMatchObject({ status: "done", agentState: "finished" });
    const noted = await client.agentMessage.findFirstOrThrow({
      where: { actionId, direction: "note" },
      orderBy: { createdAt: "desc" },
    });
    expect(noted.body).toContain("since Jane gave you their cancel page");
  });

  it("reminds the person when the charge still comes and they haven't cancelled", async () => {
    const { userId, accountId } = await person();
    const merchant = await pageOnlyMerchant();
    const { actionId } = await approve(userId, "subscription_review", merchant);
    await agentStep(userId, actionId, { client, notify });
    await client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date(Date.now() + 2 * DAY),
        amountCents: 1_549,
        description: merchant.toUpperCase(),
      },
    });
    const offered = await reload(actionId);
    const result = await confirmCancellations({
      client,
      now: new Date(offered.confirmAfter!.getTime() + DAY),
      notify,
    });
    expect(result.reminded).toBeGreaterThanOrEqual(1);
    const reminded = await reload(actionId);
    expect(reminded).toMatchObject({ status: "waiting_on_user", agentState: "confirming" });
    expect(reminded.userTodo).toContain("looks active");
    expect(reminded.confirmAfter!.getTime()).toBeGreaterThan(offered.confirmAfter!.getTime());
  });
});
