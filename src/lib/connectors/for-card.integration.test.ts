import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A card's yes, when a connector can do the act, goes through the one planner (planAction) and
// waits for the person's yes on its exact steps: no action for the team or the agent. Where no
// connector may (no consent, a real account, connections off), the yes is what it was.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import type { Prisma } from "@/generated/prisma/client";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { db } from "@/lib/db";
import { recordDecision } from "@/lib/decisions";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what a card's yes wrote", db);
const CANCEL = "sandbox_subscription_cancel";

describe.runIf(url)("a card's yes through the connector planner", () => {
  const people: string[] = [];

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
  });

  async function subscriptionFinding(userId: string) {
    const f = findingOfType("subscription_review");
    const finding = await db.finding.create({
      data: {
        userId,
        type: f.type,
        key: `${f.key}:${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    return { id: finding.id, hash: cardHash(buildCard(finding)) };
  }
  const yes = (userId: string, finding: { id: string; hash: string }) =>
    recordDecision(userId, { findingId: finding.id, choice: "yes", cardHash: finding.hash });
  const actionsOf = (userId: string) => system().action.findMany({ where: { userId } });
  const plansOf = (userId: string) => system().connectorAction.findMany({ where: { userId } });

  it("plans a cancellation for a sample person who agreed, and queues nothing", async () => {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, CANCEL, ["cancel_subscriptions"]);
    const finding = await subscriptionFinding(userId);

    const result = await yes(userId, finding);

    expect(result.actionId).toBeNull();
    expect(result.agentJobId).toBeUndefined();
    const plans = await plansOf(userId);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: result.connectorActionId,
      connectorId: CANCEL,
      kind: "cancel_subscription",
      status: "awaiting_yes",
      idempotencyKey: `finding:${finding.id}`,
      simulated: true,
    });
    expect(await actionsOf(userId)).toHaveLength(0);
    const audit = await system().auditLog.findMany({
      where: { targetId: finding.id, event: "decision_made" },
    });
    expect(audit[0]?.metadata).toMatchObject({ connector_action_id: result.connectorActionId });
  });

  it("queues the action as before when the person hasn't agreed to the connector", async () => {
    const userId = await samplePerson(db);
    people.push(userId);
    const result = await yes(userId, await subscriptionFinding(userId));
    expect(result.connectorActionId).toBeUndefined();
    expect(result.actionId).not.toBeNull();
    expect(await plansOf(userId)).toHaveLength(0);
  });

  it("never plans for a real account, and plans nothing with connections off", async () => {
    const real = await realPerson(db);
    people.push(real);
    await grantConsent(real, CANCEL, ["cancel_subscriptions"]).catch(() => undefined);
    await yes(real, await subscriptionFinding(real));
    expect(await plansOf(real)).toHaveLength(0);

    vi.stubEnv("CONNECTORS", "");
    const sample = await samplePerson(db);
    people.push(sample);
    await grantConsent(sample, CANCEL, ["cancel_subscriptions"]).catch(() => undefined);
    const result = await yes(sample, await subscriptionFinding(sample));
    expect(result.connectorActionId).toBeUndefined();
    expect(await plansOf(sample)).toHaveLength(0);
  });
});
