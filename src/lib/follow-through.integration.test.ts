import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { BANK_BALANCE_STALE_DAYS } from "@/config/detection/forecast";
import { confirmCancellations } from "@/lib/agent/run";
import { loadDetectionInput } from "@/detection/engine";
import { staleBalanceFrom } from "@/detection/forecast";

// Two reads of what a real person is told against what happens. "No charge since you cancelled:
// done" came from having no rows at all, and a bank days out of date gave today's "safe to spend".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("what depends on data being there", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `through-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    return id;
  };
  const bank = (userId: string, days: number, status = "active") =>
    client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `real-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
        status,
        lastSyncedAt: new Date(NOW.getTime() - days * DAY),
        accounts: {
          create: {
            userId,
            source: "plaid",
            name: "Checking",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 100_000,
          },
        },
      },
      select: { id: true },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("doesn't call a bank's balance today's once its sync is days old", async () => {
    const userId = await person();
    await bank(userId, BANK_BALANCE_STALE_DAYS + 40);
    const input = await loadDetectionInput(userId, { client, now: NOW });
    expect(staleBalanceFrom(input.accounts[0]!, input.asOf)).not.toBeNull();
  });

  it("leaves a balance from last night's sync alone", async () => {
    const userId = await person();
    await bank(userId, 1);
    const input = await loadDetectionInput(userId, { client, now: NOW });
    expect(input.accounts[0]?.balanceAsOf).toBeUndefined();
  });

  const cancelling = async (userId: string) => {
    const finding = await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: `merchant:netflix-${crypto.randomUUID()}`,
        title: "Review your Netflix subscription",
        annualSavingsCents: 18_588,
        amountCents: 1_549,
        confidence: "high",
        evidence: { merchant: "Netflix" },
      },
      select: { id: true },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: {} },
      select: { id: true },
    });
    const { id } = await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "cancel_subscription",
        status: "in_progress",
        agentState: "confirming",
        cancelledOn: new Date(NOW.getTime() - 40 * DAY),
        confirmAfter: new Date(NOW.getTime() - DAY),
        startedAt: new Date(NOW.getTime() - 40 * DAY),
      },
      select: { id: true },
    });
    return id;
  };

  it("doesn't say a cancel is done when it can't see any charges", async () => {
    const userId = await person();
    await bank(userId, 30, "login_required");
    const id = await cancelling(userId);
    const notify = vi.fn(async () => undefined);
    const { confirmed } = await confirmCancellations({
      client,
      now: NOW,
      notify: notify as never,
      userIds: [userId],
    });
    expect(confirmed).toBe(0);
    const row = await client.action.findUniqueOrThrow({ where: { id } });
    expect(row.status).not.toBe("done");
    expect(row.confirmAfter!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("does when the data is fresh and no charge came", async () => {
    const userId = await person();
    await bank(userId, 1);
    await cancelling(userId);
    const { confirmed } = await confirmCancellations({
      client,
      now: NOW,
      notify: vi.fn(async () => undefined) as never,
      userIds: [userId],
    });
    expect(confirmed).toBe(1);
  });
});

describe("a Yes on a real account", () => {
  it("stays where the person can find it", () => {
    const page = readFileSync("src/app/report/page.tsx", "utf8");
    expect(page).toContain("<StepsStarted");
    expect(page).toMatch(/choice: "diy"/);
  });
});
