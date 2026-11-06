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
import { agentStep, handleReply } from "./run";
import { simulatedBody } from "./simulated-company";

// The From line is the sender's to write: anyone can put the company's own address there. A reply
// is acted on only when the mail provider verified it (DMARC passed), against a real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a reply whose sender wasn't verified", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const read = vi.fn((reply: { subject: string; body: string }) =>
    Promise.resolve(readReplyByRules(reply.body)),
  );

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("is kept on the timeline, unread, even from the company's own address", async () => {
    const user = await client.user.create({
      data: { email: `verified-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
    });
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
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId! } });
    const { toAddress } = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id, direction: "outbound" },
    });
    const reply = (verified?: boolean) =>
      handleReply(
        `reply+${action.replyToken}@agent.jane.test`,
        {
          from: toAddress,
          subject: "Re: your request",
          body: simulatedBody("done", "request_refund", "Target"),
          ...(verified === undefined ? {} : { verified }),
        },
        { client, read, notify },
      );

    expect(await reply()).toBe("kept");
    expect(await reply(false)).toBe("kept");
    expect(read).not.toHaveBeenCalled();
    expect(await client.action.findUniqueOrThrow({ where: { id: action.id } })).toMatchObject({
      status: "in_progress",
      agentState: "waiting_reply",
    });
    // The unverified copies kept first don't stand in the way of the company's own.
    expect(await reply(true)).toBe("acted");
  });
});
