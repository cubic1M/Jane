import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ raiseAlerts: vi.fn() }));

import { loadDetectionInput, runDetection } from "./engine";

// Runs against a real, migrated Postgres (see engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("charges after a cancellation, against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `refunds-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Card", type: "credit", subtype: "credit card" },
    });
    await client.transaction.createMany({
      data: ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((date) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `hulu-${date}`,
        date: day(date),
        amountCents: 1199,
        description: "HULU 877-8244858 CA",
        merchantName: "Hulu",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        categorySource: "rule" as const,
      })),
    });
    // We cancelled Hulu on Sep 1; it charged on Sep 15 and Oct 15 anyway.
    const finding = await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: "merchant:hulu",
        title: "Review your Hulu subscription",
        confidence: "high",
        evidence: {},
        status: "done",
      },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: {} },
    });
    await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "cancel_subscription",
        status: "done",
        completedAt: day("2026-09-01"),
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("loads the subscriptions our team cancelled", async () => {
    const input = await loadDetectionInput(userId, { client, now: NOW });
    expect(input.cancelledMerchants).toEqual([{ merchantKey: "hulu", cancelledOn: "2026-09-01" }]);
  });

  it("finds the charges since as a refund", async () => {
    await runDetection(userId, { client, now: NOW, checkSubscriptions: async () => new Map() });

    const finding = await client.finding.findFirst({
      where: { userId, type: "charge_after_cancel" },
    });
    expect(finding).toMatchObject({ key: "merchant:hulu", annualSavingsCents: 2398 });
  });
});
