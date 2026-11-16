import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { firstWeekChecklist } from "./checklist";

// Debug 2 re-walk (11-16, upload S1, 1280 light): every card in the dock answered (Yes on the
// Saver's Credit and the emergency cushion, a subscription's steps, budgets set and turned down),
// and Home's checklist still said "Answer 2 of Jane's suggestions · 1 of 2": it counted only
// decisions on findings, and the scan's suggestions are cards in the same dock.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T16:45:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe.runIf(url)("the checklist counts answered suggestions", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(email: string) {
    const user = await client.user.create({
      data: { email, createdAt: new Date(NOW.getTime() - DAY_MS) },
    });
    created.push(user.id);
    await client.account.create({
      data: { userId: user.id, source: "csv", name: "Capital One 360", type: "depository" },
    });
    return user.id;
  }

  const suggestion = (userId: string, topic: string, answeredAt: Date | null) =>
    client.suggestion.create({
      data: {
        userId,
        key: `money:${topic}`,
        capability: "money",
        topic,
        title: topic,
        worthCents: 10_000,
        worthKind: "yearly",
        confidencePercent: 55,
        confidenceReason: "a test",
        urgency: "normal",
        why: "a test",
        actionLabel: "Open",
        actionHref: "/money",
        status: answeredAt ? "yes" : "waiting",
        answeredAt,
      },
    });

  const reviewItem = async (userId: string) =>
    (await firstWeekChecklist(userId, { client, now: NOW }))?.items.find(
      (i) => i.key === "review_cards",
    );

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("ticks the item once Jane's suggestions are answered", async () => {
    const userId = await person("checklist-suggestions-yes@example.com");
    await suggestion(userId, "savers_credit", NOW);
    await suggestion(userId, "emergency_fund", NOW);
    expect(await reviewItem(userId)).toMatchObject({
      label: "Answer 2 of Jane's suggestions",
      done: true,
    });
  });

  it("shows progress when one is answered, and Not now isn't an answer", async () => {
    const userId = await person("checklist-suggestions-one@example.com");
    await suggestion(userId, "savers_credit", NOW);
    await suggestion(userId, "lifeline", null);
    expect(await reviewItem(userId)).toMatchObject({ done: false, progress: "1 of 2" });
  });
});
