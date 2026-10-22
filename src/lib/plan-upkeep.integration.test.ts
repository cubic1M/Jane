import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { upkeepSource } from "@/lib/jane-agent/sources/upkeep";
import { currentTuneUp, pendingGoalTransfers, runPlanUpkeep } from "./plan-upkeep";

// Spec step 101 against a real, migrated Postgres: on Nov 2 a Food budget of $300 meets
// three months of about $450, and $250 moved to savings; at "Ask me first" nothing changes
// until a tap (Accept all, Keep, Count it, Not this one); at "Handle the safe stuff" Jane
// applies the tune-up and counts the transfer by herself, with Undo on the tune-up.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles on Monday Nov 2, 2026.
const NOW = new Date("2026-11-02T17:00:00Z");

describe.runIf(url)("plans that keep up, against a real database", { timeout: 30_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string, autopilot: "ask" | "safe" | null) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, autopilot },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const row = (
      date: string,
      description: string,
      amountCents: number,
      pfc: [string, string],
    ) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      pfcPrimary: pfc[0],
      pfcDetailed: pfc[1],
    });
    const FOOD: [string, string] = ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"];
    await client.transaction.createMany({
      data: [
        row("2026-08-10", "GROCER", 45_000, FOOD),
        row("2026-09-10", "GROCER", 44_000, FOOD),
        row("2026-10-10", "GROCER", 46_000, FOOD),
        row("2026-10-20", "ONLINE TRANSFER TO SAVINGS", 25_000, [
          "TRANSFER_OUT",
          "TRANSFER_OUT_SAVINGS",
        ]),
      ],
    });
    await client.budget.create({
      data: { userId: user.id, category: "Food and drink", amountCents: 30_000 },
    });
    await client.savingsGoal.create({
      data: {
        userId: user.id,
        name: "Trip",
        targetCents: 300_000,
        targetDate: new Date("2027-06-01T00:00:00Z"),
        manualSavedCents: 100_000,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    });
    return user.id;
  }

  async function post(userId: string) {
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    await postMessages(
      userId,
      gather(snapshot!, NOW, { trigger: "open", sources: [upkeepSource] }),
      {
        client,
        now: NOW,
      },
    );
    return client.janeMessage.findMany({
      where: { userId, dedupeKey: { startsWith: "upkeep:" } },
      orderBy: { createdAt: "asc" },
    });
  }
  const food = async (userId: string) =>
    (await client.budget.findFirstOrThrow({ where: { userId, category: "Food and drink" } }))
      .amountCents;
  const saved = async (userId: string) =>
    (await client.savingsGoal.findFirstOrThrow({ where: { userId } })).manualSavedCents;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("changes nothing without a tap at 'Ask me first', then Accept all and Count it do", async () => {
    const userId = await person("upkeep-ask", "ask");
    expect(await runPlanUpkeep(userId, { client, now: NOW })).toEqual({ tuned: 0, counted: 0 });
    await runJaneAgent(userId, { client, now: NOW, trigger: "cron" });
    expect(await food(userId)).toBe(30_000);
    expect(await saved(userId)).toBe(100_000);

    const [tune, transfer] = await post(userId);
    expect(tune.body).toBe(
      "Budget tune-up for November, from what you usually spend: Food and drink $300.00 → $450.00.",
    );
    expect(transfer.body).toBe(
      'You moved $250.00 to savings on Oct 20. Count it toward your goal "Trip"?',
    );
    await takeChatAction(userId, tune.id, "tuneup.accept", { client, now: NOW });
    expect(await food(userId)).toBe(45_000);
    const { message } = await takeChatAction(userId, transfer.id, "transfer.count", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toBe('Counted. "Trip" is at $1,250.00 of $3,000.00.');
    expect(await saved(userId)).toBe(125_000);
    // Counted once.
    expect(await pendingGoalTransfers(userId, { client, now: NOW })).toEqual([]);
    expect((await currentTuneUp(userId, { client, now: NOW }))?.status).toBe("accepted");
  });

  it("keeps the budgets on Keep, and skips a transfer on Not this one", async () => {
    const userId = await person("upkeep-keep", null);
    const [tune, transfer] = await post(userId);
    await takeChatAction(userId, tune.id, "tuneup.keep", { client, now: NOW });
    await takeChatAction(userId, transfer.id, "transfer.skip", { client, now: NOW });
    expect(await food(userId)).toBe(30_000);
    expect(await saved(userId)).toBe(100_000);
    // Neither comes back, and autopilot turned on later doesn't override them.
    await client.user.update({ where: { id: userId }, data: { autopilot: "safe" } });
    expect(await runPlanUpkeep(userId, { client, now: NOW })).toEqual({ tuned: 0, counted: 0 });
    expect(await food(userId)).toBe(30_000);
  });

  it("applies both by herself at 'Handle the safe stuff', and Undo puts the budget back", async () => {
    const userId = await person("upkeep-safe", "safe");
    await runJaneAgent(userId, { client, now: NOW, trigger: "cron" });
    expect(await food(userId)).toBe(45_000);
    expect(await saved(userId)).toBe(125_000);
    const [tuned, counted] = await post(userId);
    expect(tuned.body).toMatch(
      /^I tuned your budgets for November to what you usually spend \(autopilot\): Food and drink \$300\.00 → \$450\.00\. You can undo it\.$/,
    );
    expect(counted.body).toBe(
      'I counted the $250.00 you moved to savings toward "Trip" (autopilot). That\'s $1,250.00 of $3,000.00.',
    );
    await takeChatAction(userId, tuned.id, "tuneup.undo", { client, now: NOW });
    expect(await food(userId)).toBe(30_000);
    // Running again doesn't redo it.
    await runPlanUpkeep(userId, { client, now: NOW });
    expect(await food(userId)).toBe(30_000);
  });

  it("offers no tune-up after the first week of the month", async () => {
    const userId = await person("upkeep-late", "ask");
    expect(
      await currentTuneUp(userId, { client, now: new Date("2026-11-12T17:00:00Z") }),
    ).toBeNull();
  });

  it("reviews the week when asked and for Claude, never as a message of its own", async () => {
    const userId = await person("upkeep-review", "ask");
    // Sunday Nov 8, 6pm in Los Angeles: the last day of the week of Nov 2. The week is a line
    // of Monday's brief now (docs/feature-audit.md, cluster 2).
    const sunday = new Date("2026-11-09T02:00:00Z");
    await runJaneAgent(userId, { client, now: sunday, trigger: "cron" });
    expect(
      await client.janeMessage.count({ where: { userId, dedupeKey: { startsWith: "review:" } } }),
    ).toBe(0);
    const typed = await answerByRules(userId, { kind: "review" }, { client, now: sunday });
    expect(typed?.body).toMatch(/^Here's your week with Jane\.\n- Done: /);
    const tool = JSON.parse(
      (await runChatTool(userId, "plan_upkeep", {}, { client, now: NOW })).content,
    );
    expect(tool.tuneUp).toMatchObject({ month: "2026-11", status: "proposed" });
    expect(tool.transfersToCount).toEqual([
      { amount: "$250.00", date: "2026-10-20", goal: "Trip" },
    ]);
  });

  it("only touches the person's own budgets and goals", async () => {
    const mine = await person("upkeep-mine", "ask");
    const other = await person("upkeep-other", "ask");
    const [tune] = await post(mine);
    await expect(
      takeChatAction(other, tune.id, "tuneup.accept", { client, now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await food(other)).toBe(30_000);
    expect(await food(mine)).toBe(30_000);
  });
});
