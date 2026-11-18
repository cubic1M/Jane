import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { firstWeekChecklist } from "./checklist";

// Debugger 11-18 (r341, Plaid S6 on a phone): Yes on the dock's "Pay down the card charging
// interest" opened the card-interest finding, "Show me how" there gave its steps, and Home's
// checklist said "Answer 3 of Jane's suggestions · 2 of 3": the dock card and its finding were
// counted as two answers to two things.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T08:45:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe.runIf(url)("a dock card and its finding", () => {
  let client: PrismaClient;
  let userId = "";

  const finding = (type: "card_interest" | "bank_fees" | "subscription_review") =>
    client.finding.create({
      data: {
        userId,
        type,
        key: crypto.randomUUID(),
        title: type,
        confidence: "high",
        evidence: {},
      },
    });
  const suggestion = (topic: string, answeredAt: Date | null) =>
    client.suggestion.create({
      data: {
        userId,
        key: `money:${topic}`,
        capability: "money",
        topic,
        title: topic,
        worthCents: 37_100,
        worthKind: "saves",
        confidencePercent: 95,
        confidenceReason: "a test",
        urgency: "soon",
        why: "a test",
        actionLabel: "Open",
        actionHref: "/loans/interest",
        status: answeredAt ? "yes" : "waiting",
        answeredAt,
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: {
        email: `checklist-one-answer-${crypto.randomUUID()}@example.com`,
        createdAt: new Date(NOW.getTime() - DAY_MS),
      },
    });
    userId = user.id;
    await client.account.create({
      data: { userId, source: "plaid", name: "Plaid checking", type: "depository" },
    });
    const interest = await finding("card_interest");
    await finding("bank_fees");
    await finding("subscription_review");
    await suggestion("card_interest", NOW);
    await client.decision.create({
      data: { userId, findingId: interest.id, choice: "diy", cardSnapshot: {} },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("count as one answer", async () => {
    const item = (await firstWeekChecklist(userId, { client, now: NOW }))?.items.find(
      (i) => i.key === "review_cards",
    );
    expect(item).toMatchObject({ label: "Answer 3 of Jane's suggestions", progress: "1 of 3" });
  });
});
