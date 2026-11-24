import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Review of #2236. A yes a connector planned has no queued action, so (1) Revert takes back its
// plan and reopens the card instead of refusing, (2) a yes that loses the claim on its finding to
// another answer leaves no plan behind, and (3) a yes that lost to another yes keeps the shared plan.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

// What happens right after a card's plan is made, standing in for another request that answers the
// same finding at that moment.
const after: { run: (() => Promise<void>) | null } = { run: null };
vi.mock("@/lib/connectors/for-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/connectors/for-card")>();
  return {
    ...real,
    planForCard: async (...args: Parameters<typeof real.planForCard>) => {
      const plan = await real.planForCard(...args);
      await after.run?.();
      return plan;
    },
  };
});

import type { Prisma } from "@/generated/prisma/client";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { db } from "@/lib/db";
import { recordDecision } from "@/lib/decisions";
import { undoApproval } from "@/lib/standing-rules";
import { cancelAction } from "./pipeline";
import { systemDb } from "@/lib/system-db";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { cancelCardPlan } from "./for-card";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what a card's yes wrote", db);
const CANCEL = "sandbox_subscription_cancel";

describe.runIf(url)("a connector-backed yes: revert, and a yes that loses its claim", () => {
  const people: string[] = [];

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    after.run = null;
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
  });

  async function setUp() {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, CANCEL, ["cancel_subscriptions"]);
    const f = findingOfType("subscription_review");
    const row = await db.finding.create({
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
    return { userId, findingId: row.id, hash: cardHash(buildCard(row)) };
  }
  const yes = (s: { userId: string; findingId: string; hash: string }) =>
    recordDecision(s.userId, { findingId: s.findingId, choice: "yes", cardHash: s.hash });
  const plansOf = (userId: string) =>
    system().connectorAction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const statusOf = async (findingId: string) =>
    (await system().finding.findUniqueOrThrow({ where: { id: findingId } })).status;

  it("takes the plan back on Revert, reopens the card, and lets a second yes plan afresh", async () => {
    const s = await setUp();
    const first = await yes(s);
    expect(first.connectorActionId).toBeDefined();
    expect(await statusOf(s.findingId)).toBe("approved");

    await undoApproval(s.userId, first.decisionId, "card", 24);

    const [plan] = await plansOf(s.userId);
    expect(plan).toMatchObject({ id: first.connectorActionId, status: "cancelled" });
    expect(plan?.idempotencyKey).not.toBe(`finding:${s.findingId}`);
    expect(await statusOf(s.findingId)).toBe("shown");
    const decision = await system().decision.findUniqueOrThrow({ where: { id: first.decisionId } });
    expect(decision.undoneAt).not.toBeNull();

    const second = await yes(s);
    expect(second.connectorActionId).toBeDefined();
    expect(second.connectorActionId).not.toBe(first.connectorActionId);
    expect((await plansOf(s.userId)).map((p) => p.status)).toEqual(["cancelled", "awaiting_yes"]);
  });

  it("refuses Revert once the plan has reached the partner", async () => {
    const s = await setUp();
    const first = await yes(s);
    await system().connectorAction.update({
      where: { id: first.connectorActionId! },
      data: { status: "running" },
    });

    await expect(undoApproval(s.userId, first.decisionId, "card", 24)).rejects.toMatchObject({
      code: "cannot_undo",
    });
    expect(await statusOf(s.findingId)).toBe("approved");
    expect((await plansOf(s.userId))[0]?.status).toBe("running");
  });

  it("leaves no plan when a No claimed the finding first", async () => {
    const s = await setUp();
    after.run = async () => {
      await system().finding.update({ where: { id: s.findingId }, data: { status: "declined" } });
    };

    await expect(yes(s)).rejects.toMatchObject({ code: "already_decided" });

    const plans = await plansOf(s.userId);
    expect(plans.filter((p) => p.status === "awaiting_yes")).toHaveLength(0);
    expect(plans.every((p) => p.status === "cancelled")).toBe(true);
    expect(await statusOf(s.findingId)).toBe("declined");
  });

  it("keeps the shared plan when another yes holds the finding", async () => {
    const s = await setUp();
    after.run = async () => {
      await system().decision.create({
        data: {
          userId: s.userId,
          findingId: s.findingId,
          choice: "yes",
          cardSnapshot: {},
          source: "card",
        },
      });
      await system().finding.update({ where: { id: s.findingId }, data: { status: "approved" } });
    };

    await expect(yes(s)).rejects.toMatchObject({ code: "already_decided" });

    const plans = await plansOf(s.userId);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.status).toBe("awaiting_yes");
  });

  it("never reaches a plan that started running after the check: the cancel is one conditional write", async () => {
    const s = await setUp();
    const first = await yes(s);
    // The plan moved on to the partner between the lookup and the cancel.
    await system().connectorAction.update({
      where: { id: first.connectorActionId! },
      data: {
        status: "partner_pending",
        externalRef: "sandbox_ref_1",
        cancelUntil: new Date(Date.now() + 3_600_000),
      },
    });

    const taken = await cancelAction(s.userId, first.connectorActionId!, {
      beforePartner: { idempotencyKey: "freed" },
    });

    expect(taken).toBe(false);
    expect(await cancelCardPlan(s.userId, s.findingId)).toBe(false);
    const [plan] = await plansOf(s.userId);
    expect(plan).toMatchObject({
      status: "partner_pending",
      idempotencyKey: `finding:${s.findingId}`,
    });
  });

  it("cancels the plan and frees its key in the same write", async () => {
    const s = await setUp();
    const first = await yes(s);

    expect(await cancelCardPlan(s.userId, s.findingId)).toBe(true);

    const [plan] = await plansOf(s.userId);
    expect(plan).toMatchObject({
      status: "cancelled",
      idempotencyKey: `finding:${s.findingId}:cancelled:${first.connectorActionId}`,
    });
  });

  it("frees the key of a plan the person already cancelled, so Revert reopens the card", async () => {
    const s = await setUp();
    const first = await yes(s);
    // Cancelled on Connections (or by the stop-all switch): cancelAction leaves the key where it was.
    expect(await cancelAction(s.userId, first.connectorActionId!)).toBe(true);
    expect((await plansOf(s.userId))[0]?.idempotencyKey).toBe(`finding:${s.findingId}`);

    await undoApproval(s.userId, first.decisionId, "card", 24);

    expect((await plansOf(s.userId))[0]?.idempotencyKey).not.toBe(`finding:${s.findingId}`);
    expect(await statusOf(s.findingId)).toBe("shown");
    const second = await yes(s);
    expect(second.connectorActionId).not.toBe(first.connectorActionId);
  });
});
