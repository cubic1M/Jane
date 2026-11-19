import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { recordArrivals } from "./arrivals";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Debug 2, desktop sweep 8 (11-19, Plaid sandbox: checking paying Netflix $15.49 a month): after
// Settings › Refresh now, the dock had "Note Netflix's Standard with ads plan, save $78/yr", the
// day's suggestion, and "Review your Netflix subscription.", which the refresh's new finding posted
// at once. The findings source holds that card back while the cheaper plan is one of the day's
// (#2086); a finding arriving with the sync is held back the same way.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T18:00:00Z");

describe.runIf(url)("a new finding the day's suggestions already say", () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(cheaperPlanToday: boolean) {
    const user = await client.user.create({
      data: {
        email: `arrival-said-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    made.push(user.id);
    await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    if (cheaperPlanToday) {
      await client.suggestion.create({
        data: {
          userId: user.id,
          key: "subscriptions:cheaper_tier",
          capability: "subscriptions",
          topic: "cheaper_tier",
          title: "Netflix lists a cheaper plan than the one you pay for",
          headline: "Note Netflix's Standard with ads plan, save $78 a year",
          short: "Netflix: you pay $15.49, Standard with ads is $8.99.",
          worthCents: 7_800,
          worthKind: "saves",
          confidencePercent: 59,
          confidenceReason: "3 charges in 3 months of data",
          urgency: "later",
          why: "You paid Netflix $15.49.",
          actionLabel: "See my subscriptions",
          actionHref: "/subscriptions",
          status: "selected",
          selectedOn: new Date("2026-11-19T00:00:00Z"),
        },
      });
    }
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:netflix",
        title: "Review your Netflix subscription",
        annualSavingsCents: 18_588,
        amountCents: 18_588,
        confidence: "high",
        evidence: { merchant: "netflix" },
      },
    });
    await recordArrivals(user.id, [{ type: "subscription_review", key: "merchant:netflix" }], {
      client,
      now: NOW,
      trigger: "sync",
      triggerAt: NOW,
      foundAt: NOW,
    });
    const arrival = await client.findingArrival.findFirstOrThrow({ where: { userId: user.id } });
    const posted = await client.janeMessage.count({ where: { userId: user.id } });
    return { notice: arrival.notice, posted };
  }

  it("isn't posted while the service's cheaper plan is one of the day's", async () => {
    expect(await person(true)).toEqual({ notice: "suggested", posted: 0 });
  });

  it("is posted when nothing today says it", async () => {
    expect((await person(false)).notice).toBe("posted");
  });
});
