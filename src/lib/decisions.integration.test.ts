import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { findingOfType } from "./__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "./cards";
import { markDiyDone, recordDecision, undoDecision } from "./decisions";
import { savedToDate } from "./membership/service";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("decisions against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `decide-${suffix}@example.com` } })).id;
    otherUserId = (await client.user.create({ data: { email: `other-${suffix}@example.com` } })).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await client.$disconnect();
  });

  beforeEach(() => {
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  let sequence = 0;
  async function finding(owner = userId, type: Parameters<typeof findingOfType>[0] = "bank_fees") {
    const f = findingOfType(type);
    sequence += 1;
    return client.finding.create({
      data: {
        userId: owner,
        type: f.type,
        key: `${f.key}-${sequence}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: { ...CARD_SELECT, status: true },
    });
  }

  it("a yes approves the finding, queues an action and keeps the exact card shown", async () => {
    const f = await finding();
    const card = buildCard(f);

    const result = await recordDecision(
      userId,
      { findingId: f.id, choice: "yes", cardHash: cardHash(card) },
      { client },
    );

    const decision = await client.decision.findUniqueOrThrow({
      where: { id: result.decisionId },
      include: { action: true, finding: true },
    });
    expect(decision.choice).toBe("yes");
    expect(decision.cardSnapshot).toEqual(card);
    expect(decision.finding.status).toBe("approved");
    expect(decision.action).toMatchObject({
      id: result.actionId,
      userId,
      type: "recover_bank_fees",
      status: "queued",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "decision_made",
      { type: "finding", id: f.id },
      {
        choice: "yes",
        source: "card",
        changed_options: false,
        decision_id: result.decisionId,
        action_id: result.actionId,
      },
    );
    expect(track).toHaveBeenCalledWith(userId, "decision_yes", expect.any(Object));
  });

  it("a no declines without an action, and can be undone within the window", async () => {
    const f = await finding(userId, "price_increase");
    const hash = cardHash(buildCard(f));

    const result = await recordDecision(
      userId,
      { findingId: f.id, choice: "no", cardHash: hash },
      { client },
    );
    expect(result.actionId).toBeNull();
    expect((await client.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(
      "declined",
    );

    await undoDecision(userId, result.decisionId, { client });

    const decision = await client.decision.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(decision.undoneAt).not.toBeNull();
    expect((await client.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("shown");
    expect(track).toHaveBeenCalledWith(userId, "decision_undone", {});
  });

  it("refuses an undo after the window, twice, or of a yes", async () => {
    const f = await finding();
    const hash = cardHash(buildCard(f));
    const no = await recordDecision(
      userId,
      { findingId: f.id, choice: "no", cardHash: hash },
      { client },
    );
    const later = new Date(Date.now() + 60_000);
    await expect(undoDecision(userId, no.decisionId, { client, now: later })).rejects.toThrow(
      "can't be undone",
    );

    await undoDecision(userId, no.decisionId, { client });
    await expect(undoDecision(userId, no.decisionId, { client })).rejects.toThrow(
      "can't be undone",
    );

    const yes = await recordDecision(
      userId,
      { findingId: f.id, choice: "yes", cardHash: hash },
      { client },
    );
    await expect(undoDecision(userId, yes.decisionId, { client })).rejects.toThrow(
      "can't be undone",
    );
  });

  it("refuses a second answer and a card that changed since it was shown", async () => {
    const f = await finding();
    const hash = cardHash(buildCard(f));

    await expect(
      recordDecision(
        userId,
        { findingId: f.id, choice: "yes", cardHash: "0".repeat(64) },
        { client },
      ),
    ).rejects.toMatchObject({ code: "card_changed" });

    await recordDecision(userId, { findingId: f.id, choice: "yes", cardHash: hash }, { client });
    await expect(
      recordDecision(userId, { findingId: f.id, choice: "no", cardHash: hash }, { client }),
    ).rejects.toMatchObject({ code: "already_decided" });
    expect(await client.decision.count({ where: { findingId: f.id } })).toBe(1);
  });

  it("can't decide on, or undo, another user's finding", async () => {
    const theirs = await finding(otherUserId);
    const hash = cardHash(buildCard(theirs));

    await expect(
      recordDecision(userId, { findingId: theirs.id, choice: "yes", cardHash: hash }, { client }),
    ).rejects.toMatchObject({ code: "not_found" });

    const their = await recordDecision(
      otherUserId,
      { findingId: theirs.id, choice: "no", cardHash: hash },
      { client },
    );
    await expect(undoDecision(userId, their.decisionId, { client })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  describe("do it myself", () => {
    async function diy(type: Parameters<typeof findingOfType>[0] = "bank_fees") {
      const f = await finding(userId, type);
      const result = await recordDecision(
        userId,
        { findingId: f.id, choice: "diy", cardHash: cardHash(buildCard(f)) },
        { client },
      );
      return { f, result };
    }

    it("never creates a concierge action", async () => {
      const { f, result } = await diy();

      expect(result.actionId).toBeNull();
      expect(await client.action.count({ where: { decision: { findingId: f.id } } })).toBe(0);
      expect((await client.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(
        "in_progress",
      );
      expect(track).toHaveBeenCalledWith(userId, "diy_started", expect.any(Object));
    });

    it("counts its savings once in saved-to-date, after it's marked done", async () => {
      const before = await savedToDate(userId, { client });
      const { f, result } = await diy();
      expect(await savedToDate(userId, { client })).toBe(before);

      await markDiyDone(userId, result.decisionId, { client });
      await markDiyDone(userId, result.decisionId, { client });

      expect(await savedToDate(userId, { client })).toBe(before + (f.annualSavingsCents ?? 0));
      expect((await client.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("done");
      expect(track).toHaveBeenCalledWith(userId, "diy_done", {});
      expect(vi.mocked(track).mock.calls.filter(([, e]) => e === "diy_done")).toHaveLength(1);
    });

    it("can't be marked done by someone else, or on a team decision", async () => {
      const { result } = await diy();
      await expect(markDiyDone(otherUserId, result.decisionId, { client })).rejects.toThrow(
        "doesn't exist",
      );

      const f = await finding();
      const yes = await recordDecision(
        userId,
        { findingId: f.id, choice: "yes", cardHash: cardHash(buildCard(f)) },
        { client },
      );
      await expect(markDiyDone(userId, yes.decisionId, { client })).rejects.toThrow(
        "doesn't exist",
      );
    });

    it("isn't offered where there's no kit", async () => {
      const f = await finding(userId, "idle_cash");
      await expect(
        recordDecision(
          userId,
          { findingId: f.id, choice: "diy", cardHash: cardHash(buildCard(f)) },
          { client },
        ),
      ).rejects.toMatchObject({ code: "no_kit" });
    });
  });
});
