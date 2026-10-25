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
import { savedToDate } from "@/lib/membership/service";
import { agentStep } from "./run";
import { confirmRefunds } from "./refund-check";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("refunds seen in transactions, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);

  async function person(institutionName?: string) {
    const user = await client.user.create({
      data: { email: `refund-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
    });
    created.push(user.id);
    const item = institutionName
      ? await client.plaidItem.create({
          data: {
            userId: user.id,
            plaidItemId: `item-${crypto.randomUUID()}`,
            accessTokenEncrypted: "x",
            institutionName,
          },
        })
      : null;
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: item ? "plaid" : "csv",
        itemId: item?.id,
        plaidAccountId: item ? `acc-${crypto.randomUUID()}` : undefined,
        name: "Everyday Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return { userId: user.id, accountId: account.id };
  }

  async function approve(
    userId: string,
    type: "duplicate_charge" | "bank_fees",
    evidence: Record<string, unknown>,
    cents: number,
  ) {
    const finding = await client.finding.create({
      data: {
        userId,
        type,
        key: crypto.randomUUID(),
        title:
          type === "bank_fees" ? "Fees on Everyday Checking" : "Charged twice? $64.20 at Target",
        annualSavingsCents: cents,
        amountCents: cents,
        confidence: "high",
        evidence: evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    return actionId!;
  }

  const credit = (
    userId: string,
    accountId: string,
    description: string,
    cents: number,
    date = new Date(),
  ) =>
    client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date,
        amountCents: -cents,
        description,
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("closes a refund when the money comes back, and counts what came back as saved", async () => {
    const { userId, accountId } = await person();
    const actionId = await approve(
      userId,
      "duplicate_charge",
      { merchant: "Target", charges: [] },
      6_420,
    );
    await agentStep(userId, actionId, { client, notify });

    // Too little back (under half) doesn't count; a refund from someone else neither.
    await credit(userId, accountId, "TARGET 00012345 REFUND", 2_000);
    await credit(userId, accountId, "WALMART REFUND", 6_420);
    expect(await confirmRefunds(userId, { client, notify })).toBe(0);

    await credit(userId, accountId, "TARGET 00012345 REFUND", 3_000);
    expect(await confirmRefunds(userId, { client, notify })).toBe(1);
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
    expect(action).toMatchObject({ status: "done", agentState: "finished", refundCents: 5_000 });
    expect(await savedToDate(userId, { client })).toBe(5_000);
    // Counted once.
    expect(await confirmRefunds(userId, { client, notify })).toBe(0);
  });

  it("ignores money that came back before the approval", async () => {
    const { userId, accountId } = await person();
    await credit(userId, accountId, "TARGET REFUND", 6_420, new Date("2025-01-01T00:00:00Z"));
    await approve(userId, "duplicate_charge", { merchant: "Target", charges: [] }, 6_420);
    expect(await confirmRefunds(userId, { client, notify })).toBe(0);
  });

  it("closes a fee refund when the bank reverses fees on that account", async () => {
    const { userId, accountId } = await person("Chase");
    const actionId = await approve(
      userId,
      "bank_fees",
      { accountId, totalCents: 6_800, transactions: [] },
      6_800,
    );
    // The agent writes to the bank that holds the account.
    expect(await agentStep(userId, actionId, { client, notify })).toBe("sent");
    const sent = await client.agentMessage.findFirstOrThrow({ where: { actionId } });
    expect(sent.toAddress).toBe("support@chase.simulated-support.example");
    expect(sent.body).toContain("Hello Chase,");

    await credit(userId, accountId, "OVERDRAFT FEE REFUND", 6_800);
    expect(await confirmRefunds(userId, { client, notify })).toBe(1);
    expect(await client.action.findUniqueOrThrow({ where: { id: actionId } })).toMatchObject({
      status: "done",
      refundCents: 6_800,
    });
  });

  it("hands fees on an imported account to the team: the bank isn't known", async () => {
    const { userId, accountId } = await person();
    const actionId = await approve(
      userId,
      "bank_fees",
      { accountId, totalCents: 3_400, transactions: [] },
      3_400,
    );
    expect(await agentStep(userId, actionId, { client, notify })).toBe("handed_off");
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
    expect(action.handoffReason).toContain("which bank");
  });
});
