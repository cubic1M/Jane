import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OUTCOME_MIN_CASES } from "@/config/merchant-outcomes";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { companyFacts } from "./merchants";
import { refreshMerchantOutcomes } from "./merchant-outcomes";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("merchant outcomes against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  // Letters only, so the merchant name survives normalization and stays unique to this run.
  const merchant = `Outcomeflix ${Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("")}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `outcome-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  async function finished(count: number, failFirst: boolean) {
    for (let i = 0; i < count; i += 1) {
      const finding = await client.finding.create({
        data: {
          userId,
          type: "subscription_review",
          key: `k-${crypto.randomUUID()}`,
          title: "t",
          confidence: "high",
          evidence: { merchant },
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
          status: failFirst && i === 0 ? "failed" : "done",
          minutesSpent: 10 + i,
          completedAt: new Date(),
        },
      });
    }
  }

  it("shows nothing below the minimum number of cases, then the aggregate", async () => {
    await finished(OUTCOME_MIN_CASES - 1, true);
    await refreshMerchantOutcomes({ client });
    const facts = (actionType: "cancel_subscription" | "request_refund") =>
      companyFacts(merchant, { client, actionType });
    // Through the one company lookup (docs/feature-audit.md, cluster 4); a company the
    // directory doesn't know counts under its own name.
    expect(await facts("cancel_subscription")).toEqual({ merchant: null, outcome: null });

    await finished(1, false);
    await refreshMerchantOutcomes({ client });
    const { outcome } = await facts("cancel_subscription");
    expect(outcome).toMatchObject({ cases: OUTCOME_MIN_CASES, succeeded: OUTCOME_MIN_CASES - 1 });
    expect(outcome?.medianMinutes).toBeGreaterThan(0);
    // Another kind of action there has no cases yet.
    expect((await facts("request_refund")).outcome).toBeNull();
  });
});
