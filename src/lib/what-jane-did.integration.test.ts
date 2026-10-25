import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { agentStep } from "@/lib/agent/run";
import { confirmRefunds } from "@/lib/agent/refund-check";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { janeDidSomething, whatJaneDid } from "./what-jane-did";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("what Jane did, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);

  async function person() {
    const user = await client.user.create({
      data: { email: `did-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
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

  async function approvedRefund(
    userId: string,
    merchant: string,
    cents: number,
    options?: Record<string, unknown>,
  ) {
    const finding = await client.finding.create({
      data: {
        userId,
        type: "duplicate_charge",
        key: crypto.randomUUID(),
        title: `Charged twice at ${merchant}`,
        annualSavingsCents: cents,
        amountCents: cents,
        confidence: "medium",
        evidence: { merchant, charges: [] } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)), options },
      { client },
    );
    return actionId!;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("counts only confirmed money, and puts every step on the timeline", async () => {
    const { userId, accountId } = await person();
    expect(janeDidSomething(await whatJaneDid(userId, { client }))).toBe(false);

    // One refund confirmed in the transactions...
    const seen = await approvedRefund(userId, "Target", 6_420);
    await agentStep(userId, seen, { client, notify });
    await client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date(),
        amountCents: -6_420,
        description: "TARGET REFUND",
      },
    });
    await confirmRefunds(userId, { client, notify });
    // ...one still waiting on the company, and one passed to the team.
    const waiting = await approvedRefund(userId, "Gadget Shop", 4_999);
    await agentStep(userId, waiting, { client, notify });
    const disputed = await approvedRefund(userId, "Bookshop", 2_500, { method: "dispute" });
    await agentStep(userId, disputed, { client, notify });

    const did = await whatJaneDid(userId, { client });
    expect(did).toMatchObject({
      finished: [{ title: "Charged twice at Target", confirmedCents: 6_420 }],
      confirmedCents: 6_420,
      contacts: 2,
      working: 1,
      waiting: [],
    });

    const notes = await client.agentMessage.findMany({
      where: { userId, direction: "note" },
      select: { actionId: true, body: true },
    });
    expect(notes.find((n) => n.actionId === seen)?.body).toMatch(
      /^Saw \$64\.20 come back on .*: done\.$/,
    );
    expect(notes.find((n) => n.actionId === disputed)?.body).toContain("Passed to our team:");
  });
});
