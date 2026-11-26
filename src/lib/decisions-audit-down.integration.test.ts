import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { findingOfType } from "./__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "./cards";
import { recordDecision } from "./decisions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a yes whose audit record can't be written", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `audit-down-${crypto.randomUUID()}@example.com` } })
    ).id;
    // The demo bank: Jane acts for this person.
    await client.plaidItem.create({
      data: { userId, plaidItemId: `demo-${userId}`, accessTokenEncrypted: "test" },
    });
  });

  afterAll(async () => {
    await client.$executeRaw`DELETE FROM jobs WHERE payload->>'userId' = ${userId}`;
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // The answer was already saved, and a second yes is refused: without the job, nothing ever
  // worked the action.
  it("still leaves Jane's job to do it", async () => {
    const f = findingOfType("bank_fees");
    const finding = await client.finding.create({
      data: {
        userId,
        type: f.type,
        key: f.key,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: { ...CARD_SELECT, status: true },
    });
    vi.mocked(logAudit).mockRejectedValueOnce(new Error("audit log down"));
    await expect(
      recordDecision(
        userId,
        { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
        { client },
      ),
    ).rejects.toThrow("audit log down");
    const action = await client.action.findFirstOrThrow({ where: { userId } });
    expect(action.agentState).toBe("working");
    const [{ count }] = await client.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM jobs
      WHERE kind = 'agent_step' AND payload->>'actionId' = ${action.id}`;
    expect(Number(count)).toBe(1);
  });
});
