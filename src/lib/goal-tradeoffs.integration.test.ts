import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { GOAL_ORDER_FACT } from "@/config/tradeoffs";
import { logAudit } from "@/lib/audit";
import { listGoals } from "@/lib/goals";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { parseIntent } from "@/lib/jane-agent/intents";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { tradeoffsSource } from "@/lib/jane-agent/sources/tradeoffs";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import { loadYearPlan } from "@/lib/year-plan";
import { TRADEOFF_DETECTORS } from "@/detectors/tradeoffs";
import { buildProfile } from "@/profile/build";
import { fund, roomFromPlan } from "@/planning/goal-tradeoffs";
import { TradeoffError, chooseGoalOrder, loadTradeoffs } from "./goal-tradeoffs";

// Spec step 241 against a real, migrated Postgres: the Reyes family's demo bank comes with a
// trip and a kitchen redo that can't both be on time. Each order's dates come from the year
// plan, Jane suggests one and says why, and only the person's tap picks it, after which every
// sector funds the goals in that order.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("goals that trade off openly", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function reyes(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: "family" });
    await syncItem(itemId, { client, api, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("shows each order's dates from the year plan, suggests one and says why", async () => {
    const userId = await reyes("tradeoffs-view");
    const goals = await listGoals(userId, { client, now: NOW });
    expect(goals.map((g) => g.name)).toEqual(["Family trip", "Kitchen redo"]);

    const view = (await loadTradeoffs(userId, { client, now: NOW }))!;
    expect(view.competing).toBe(true);
    expect(view.chosen).toBeNull();
    expect(view.options).toHaveLength(2);
    // The dates are the year plan's: the same room, month by month, gives the same dates.
    const plan = (await loadYearPlan(userId, { client, now: NOW }))!;
    const capacity = roomFromPlan(plan.months, "2026-10");
    const open = goals.flatMap((g) =>
      g.progress.status === "on_the_way"
        ? [
            {
              id: g.id,
              name: g.name,
              leftCents: g.progress.leftCents,
              wantedMonth: g.targetDate.slice(0, 7),
              monthlyCents: g.progress.monthlyCents,
            },
          ]
        : [],
    );
    for (const option of view.options) {
      expect(option.dates).toEqual(fund(open, option.order, capacity, "2026-10").dates);
    }
    expect(view.suggested!.dates[0].name).toBe("Family trip");
    expect(view.reason).toMatch(/^Putting Family trip first leaves the least delay overall/);
    expect(view.reason).toMatch(/Kitchen redo slips \d+ months/);

    // Looking never re-plans: nothing is remembered and the order stays by date.
    expect(await client.janePreference.count({ where: { userId, key: GOAL_ORDER_FACT } })).toBe(0);
  });

  it("re-plans only on the tap, and every sector then funds goals in that order", async () => {
    const userId = await reyes("tradeoffs-pick");
    const goals = await listGoals(userId, { client, now: NOW });
    const kitchen = goals.find((g) => g.name === "Kitchen redo")!;
    const trip = goals.find((g) => g.name === "Family trip")!;
    await expect(chooseGoalOrder(userId, [kitchen.id], { client, now: NOW })).rejects.toThrow(
      TradeoffError,
    );
    await expect(
      chooseGoalOrder(userId, [kitchen.id, "not-theirs"], { client, now: NOW }),
    ).rejects.toThrow(TradeoffError);

    const picked = await chooseGoalOrder(userId, [kitchen.id, trip.id], { client, now: NOW });
    expect(picked.names).toEqual(["Kitchen redo", "Family trip"]);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "goal_order_chosen",
      { type: "savings_goal", id: kitchen.id },
      { goals: 2 },
    );
    // Every sector reads goals through listGoals: the kitchen now comes first.
    expect((await listGoals(userId, { client, now: NOW })).map((g) => g.name)).toEqual([
      "Kitchen redo",
      "Family trip",
    ]);
    const view = (await loadTradeoffs(userId, { client, now: NOW }))!;
    expect(view.chosen).toEqual([kitchen.id, trip.id]);
    expect(view.current!.order).toEqual([kitchen.id, trip.id]);
    // The year plan was kept again on the tap.
    expect(await client.yearPlan.count({ where: { userId } })).toBe(1);
  });

  it("is in the chat: the rule answer, Claude's tool, the message and its button", async () => {
    const userId = await reyes("tradeoffs-chat");
    expect(parseIntent("which goal should I save for first?", "2026-10-16")).toEqual({
      kind: "goal_tradeoffs",
    });
    const reply = (await answerByRules(userId, { kind: "goal_tradeoffs" }, { client, now: NOW }))!;
    expect(reply.body).toMatch(/one waits for another/);
    expect(reply.actions.map((a) => a.id)).toEqual(["tradeoffs.pick", "tradeoffs.keep", "open"]);

    const tool = JSON.parse(
      (await runChatTool(userId, "goal_tradeoffs", {}, { client, now: NOW })).content,
    );
    expect(tool.competing).toBe(true);
    expect(tool.suggested[0].goal).toBe("Family trip");
    expect(tool.picked).toBe(false);

    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    await postMessages(
      userId,
      gather(snapshot, NOW, { trigger: "open", sources: [tradeoffsSource] }),
      { client, now: NOW },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "tradeoffs:" } },
    });
    expect(message.kind).toBe("decision");
    const { message: answered } = await takeChatAction(userId, message.id, "tradeoffs.pick", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toBe(
      "Done. From now on your goals are funded in this order: Family trip, then Kitchen redo. Your paycheck plan and the year plan use it.",
    );
    // Once picked, the message isn't raised again.
    const after = (await loadSnapshot(userId, { client, now: NOW }))!;
    expect(gather(after, NOW, { trigger: "open", sources: [tradeoffsSource] })).toEqual([]);
  });

  it("finds its person from the loaded profile, and stays quiet without goals", async () => {
    const userId = await reyes("tradeoffs-detect");
    await loadYearPlan(userId, { client, now: NOW, keep: true });
    const data = await loadProfileInput(userId, { client, now: NOW });
    expect(data.extras?.goals).toHaveLength(2);
    expect(typeof data.extras?.goalRoomCents).toBe("number");
    const s = TRADEOFF_DETECTORS[0].detect({ profile: buildProfile(data), data });
    expect(s?.topic).toBe("goal_tradeoffs");

    const plain = await client.user.create({
      data: { email: `tradeoffs-plain-${crypto.randomUUID()}@example.com` },
    });
    created.push(plain.id);
    const { itemId } = await linkDemoBank(plain.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    // The demo bank without a sample person adds no goals.
    expect(await listGoals(plain.id, { client, now: NOW })).toEqual([]);
    expect((await loadTradeoffs(plain.id, { client, now: NOW }))!.competing).toBe(false);
  });
});
