import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { readReplyByRules } from "./read-reply";
import { agentStep, handleReply } from "./run";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the agent answering for itself, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const read = (reply: { subject: string; body: string }) =>
    Promise.resolve(readReplyByRules(reply.body));

  // A refund in progress for a charge on a card whose last 4 digits Jane knows (or not).
  async function waiting(mask: string | null) {
    const user = await client.user.create({
      data: { email: `answer-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Card",
        type: "credit",
        subtype: "credit card",
        mask,
      },
    });
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "duplicate_charge",
        key: crypto.randomUUID(),
        title: "Charged twice? $64.20 at Target",
        annualSavingsCents: 6_420,
        amountCents: 6_420,
        confidence: "medium",
        evidence: {
          merchant: "Target",
          accountId: account.id,
          charges: [
            { date: "2026-10-15", amountCents: 6_420 },
            { date: "2026-10-16", amountCents: 6_420 },
          ],
        } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    await agentStep(user.id, actionId!, { client, notify });
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId! } });
    const ask = (body: string) =>
      handleReply(
        `reply+${action.replyToken}@agent.jane.test`,
        { from: "support@target.example", subject: "Re: refund", body },
        { client, read, notify },
      );
    return { action, ask };
  }

  const reload = (id: string) => client.action.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("answers the last 4 digits itself, without asking the person", async () => {
    const { action, ask } = await waiting("4821");
    await ask("Hi, could you confirm the last 4 digits of the card that was charged?");
    expect(await reload(action.id)).toMatchObject({
      status: "in_progress",
      agentState: "waiting_reply",
      userTodo: null,
    });
    const sent = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id, direction: "outbound" },
      orderBy: { createdAt: "desc" },
    });
    expect(sent.body).toContain("The card ends in 4821.");
    const noted = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id, direction: "note" },
    });
    expect(noted.body).toContain("Answered Target's question");
  });

  it("asks the person when Jane doesn't know the answer", async () => {
    const { action, ask } = await waiting(null);
    await ask("Could you confirm the last 4 digits of the card?");
    const after = await reload(action.id);
    expect(after.status).toBe("waiting_on_user");
    expect(after.userTodo).toContain("Answer on your actions page");
  });

  it("never gives out a password, and warns the person", async () => {
    const { action, ask } = await waiting("4821");
    await ask("To process this, please confirm the account password.");
    const after = await reload(action.id);
    expect(after).toMatchObject({ status: "waiting_on_user", agentState: "handed_off" });
    expect(after.userTodo).toContain("Jane never shares that");
    const outbound = await client.agentMessage.count({
      where: { actionId: action.id, direction: "outbound" },
    });
    expect(outbound).toBe(1);
  });
});
