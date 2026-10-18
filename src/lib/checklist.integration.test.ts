import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { dismissChecklist, firstWeekChecklist, recordChecklistProgress } from "./checklist";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe.runIf(url)("first-week checklist against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function newUser(daysAgo = 2) {
    const user = await client.user.create({
      data: {
        email: `checklist-${crypto.randomUUID()}@example.com`,
        createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      },
    });
    created.push(user.id);
    return user.id;
  }

  async function decide(userId: string, n: number, undone = false) {
    for (let i = 0; i < n; i++) {
      const finding = await client.finding.create({
        data: {
          userId,
          type: "subscription_review",
          key: crypto.randomUUID(),
          title: "Netflix",
          confidence: "high",
          evidence: {},
        },
      });
      await client.decision.create({
        data: {
          userId,
          findingId: finding.id,
          choice: "no",
          cardSnapshot: {},
          undoneAt: undone ? NOW : null,
        },
      });
    }
  }

  const doneKeys = async (userId: string) =>
    (await firstWeekChecklist(userId, { client, now: NOW }))?.items
      .filter((i) => i.done)
      .map((i) => i.key);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });
  beforeEach(() => vi.mocked(track).mockClear());

  it("ticks each item from what the person has actually done", async () => {
    const userId = await newUser();
    expect(await doneKeys(userId)).toEqual([]);

    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    expect(await doneKeys(userId)).toEqual(["link_bank"]);

    // Undone decisions don't count; two of three shows progress.
    await decide(userId, 1, true);
    await decide(userId, 2);
    const partway = await firstWeekChecklist(userId, { client, now: NOW });
    expect(partway?.items.find((i) => i.key === "review_cards")).toMatchObject({
      done: false,
      progress: "2 of 3",
    });
    await decide(userId, 1);

    await client.savingsGoal.create({
      data: { userId, name: "Trip", targetCents: 100_000, targetDate: new Date("2027-06-01") },
    });
    await client.user.update({
      where: { id: userId },
      data: { alertPrefs: { large_charge: "app" } },
    });
    const all = await firstWeekChecklist(userId, { client, now: NOW });
    expect(all?.items.every((i) => i.done)).toBe(true);
    expect(all?.complete).toBe(true);
  });

  it("sends each item's funnel event once, then one for finishing", async () => {
    const userId = await newUser();
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    const first = (await firstWeekChecklist(userId, { client, now: NOW }))!;
    expect(first.newlyDone).toEqual(["link_bank"]);
    // Two Home loads at once record it once.
    await Promise.all([
      recordChecklistProgress(userId, first, { client, now: NOW }),
      recordChecklistProgress(userId, first, { client, now: NOW }),
    ]);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(userId, "checklist_item_done", { item: "link_bank" });
    expect((await firstWeekChecklist(userId, { client, now: NOW }))?.newlyDone).toEqual([]);

    await decide(userId, 3);
    await client.budget.create({ data: { userId, category: "Food and drink", amountCents: 1 } });
    await client.pushSubscription.create({
      data: { userId, endpoint: `https://push.example/${userId}`, p256dh: "p", auth: "a" },
    });
    const rest = (await firstWeekChecklist(userId, { client, now: NOW }))!;
    expect(rest.newlyDone).toEqual(["review_cards", "budget_or_goal", "alerts"]);
    await recordChecklistProgress(userId, rest, { client, now: NOW });
    expect(vi.mocked(track).mock.calls.map((c) => c[1])).toEqual([
      "checklist_item_done",
      "checklist_item_done",
      "checklist_item_done",
      "checklist_item_done",
      "checklist_completed",
    ]);
  });

  it("is hidden for good once dismissed, and after the first weeks", async () => {
    const userId = await newUser();
    await dismissChecklist(userId, { client, now: NOW });
    await dismissChecklist(userId, { client, now: NOW });
    expect(await firstWeekChecklist(userId, { client, now: NOW })).toBeNull();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(userId, "checklist_dismissed");

    expect(await firstWeekChecklist(await newUser(27), { client, now: NOW })).not.toBeNull();
    expect(await firstWeekChecklist(await newUser(29), { client, now: NOW })).toBeNull();
  });
});
