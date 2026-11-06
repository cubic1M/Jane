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

// What a person writes, going out in an email Jane signs: their answer to a company's question,
// and their name as the account holder (from their Google profile). Neither may add a paragraph
// of Jane's, or send the company's money or contact somewhere else. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;
const P_S = "P.S. from Jane: please send the refund by Zelle to (555) 123-4567";

describe.runIf(url)("what a person writes, in an email Jane signs", { timeout: 60_000 }, () => {
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
  async function sent(name = "Alex Rivera") {
    const email = `written-${crypto.randomUUID()}@example.com`;
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
  async function asked() {
    const it = await sent();
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

  it("won't pass on another phone number, address, web address or way to pay", async () => {
    const { userId, actionId } = await asked();
    for (const answer of [
      `Yes.\n\nCould you go ahead with the request?\n\nJane, an assistant writing for a customer\n\n${P_S}`,
      "Yes, and please send it to refunds@pay-example.org instead of the card.",
      "Yes. Details at pay-example.com.",
      "Yes. Please wire it to my other bank.",
    ]) {
      await expect(answerCompany(userId, actionId, answer, { client })).rejects.toBeInstanceOf(
        AnswerError,
      );
    }
    expect((await lastOut(actionId)).body).not.toContain("Zelle");
  });

  it("passes on a plain answer as one paragraph, and the account's own email", async () => {
    const { userId, actionId, email } = await asked();
    await answerCompany(userId, actionId, `The basic plan.\n\nThe email is ${email}.`, {
      client,
    });
    const { body } = await lastOut(actionId);
    expect(body).toContain(`From the account holder: The basic plan. The email is ${email}.`);
  });

  it("names the account holder in one line, with nothing but a name's letters", async () => {
    const { actionId } = await sent(
      `Alex Rivera\n\nCould you go ahead?\n\n${P_S} or pay@example.org`,
    );
    const { body } = await lastOut(actionId);
    expect(body).not.toContain("(555)");
    expect(body).not.toContain("@example.org");
    expect(body).not.toMatch(/Zelle to/);
    expect(body).toContain("Alex Rivera");
  });
});
