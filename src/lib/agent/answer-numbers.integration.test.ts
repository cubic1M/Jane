import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/concierge-mode", () => ({
  conciergeMode: vi.fn(async () => true),
  onSampleDataOnly: vi.fn(async () => false),
}));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { readReplyByRules } from "./read-reply";
import { AnswerError, agentStep, answerCompany, handleReply } from "./run";
import { simulatedBody } from "./simulated-company";

// The numbers in a person's answer to a company. A shorter one a company asks for goes out; a
// long one doesn't, by the rule that card and account numbers only go out as their last 4; a phone
// number to call never does. The account's own email may go, whatever digits are in it. Against a
// real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("numbers in a person's answer to a company", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const read = (reply: { subject: string; body: string }) =>
    Promise.resolve(readReplyByRules(reply.body));

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  // A refund request with its first email sent, for a person with this name.
  async function sent(name = "Alex Rivera", email = `written-${crypto.randomUUID()}@example.com`) {
    const user = await client.user.create({ data: { email, name } });
    created.push(user.id);
    const f = findingOfType("duplicate_charge");
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    await agentStep(user.id, actionId!, { client, notify });
    return { userId: user.id, actionId: actionId!, email };
  }

  // The same, with the company asking a question Jane can't answer itself.
  async function asked(email?: string) {
    const it = await sent(undefined, email);
    const action = await client.action.findUniqueOrThrow({ where: { id: it.actionId } });
    const { toAddress } = await client.agentMessage.findFirstOrThrow({
      where: { actionId: it.actionId, direction: "outbound" },
    });
    await handleReply(
      `reply+${action.replyToken}@agent.jane.test`,
      {
        from: toAddress,
        subject: "Re: your request",
        body: simulatedBody("needs_info", "request_refund", "Target"),
        verified: true,
      },
      { client, read, notify },
    );
    return it;
  }

  const lastOut = (actionId: string) =>
    client.agentMessage.findFirstOrThrow({
      where: { actionId, direction: "outbound" },
      orderBy: { createdAt: "desc" },
    });

  it("passes on a shorter number the company asks for", async () => {
    for (const answer of [
      "My account number is 4402918837",
      "Order 112-3456789",
      "Member ID 908112447",
    ]) {
      const { userId, actionId } = await asked();
      await answerCompany(userId, actionId, answer, { client });
      expect((await lastOut(actionId)).body).toContain(`From the account holder: ${answer}`);
    }
  });

  it("passes on the account's own email, whatever digits are in it", async () => {
    const { userId, actionId } = await asked("alex-2026-1105-4402-9188@example.com");
    const answer = "The email is alex-2026-1105-4402-9188@example.com.";
    await answerCompany(userId, actionId, answer, { client });
    expect((await lastOut(actionId)).body).toContain(`From the account holder: ${answer}`);
  });

  it("still won't pass on a long number, a phone number or a card number", async () => {
    const { userId, actionId } = await asked();
    for (const answer of [
      "Order 112-3456789-0123456",
      "Member ID 908 112 4471",
      "Call me at (555) 123-4567",
      "Reach me on 555-123-4567",
      "My number is +1 555 123 4567",
      "text 5551234",
      "4111 1111 1111 1111",
    ]) {
      await expect(answerCompany(userId, actionId, answer, { client })).rejects.toBeInstanceOf(
        AnswerError,
      );
    }
  });
});
