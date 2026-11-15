import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { BudgetProposal, GoalProposal } from "@/planning/proposals";
import { takeChatAction } from "./actions";
import { setupBody } from "./sources/setup";
import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// Debugger 11-15: with the emergency fund's set-up card put away (a suggestion brings it up), the two
// budget cards left still said "Use all 3 suggestions", and tapping it set up the emergency fund goal
// too, a card the person never saw. "Use all" counts and sets up the cards shown.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-15T12:30:00Z");

const goal: GoalProposal = {
  kind: "goal",
  key: "goal:emergency_fund",
  name: "Emergency fund",
  targetCents: 570_000,
  targetDate: "2027-11-15",
  monthlySpendingCents: 189_700,
  basis: "3 months of your own average spending",
};
const food: BudgetProposal = {
  kind: "budget",
  key: "budget:Food and drink",
  category: "Food and drink",
  amountCents: 40_000,
};
const fun: BudgetProposal = {
  kind: "budget",
  key: "budget:Entertainment",
  category: "Entertainment",
  amountCents: 3_000,
};

describe.runIf(url)("Use all, beside a set-up goal a suggestion covers", () => {
  let client: PrismaClient;
  let userId: string;

  const card = async (p: BudgetProposal | GoalProposal) => {
    await client.planProposal.create({
      data: { userId, key: p.key, kind: p.kind, payload: p as object },
    });
    return client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: setupBody(p),
        refs: { proposalKey: p.key },
        actions: [
          { id: "setup.yes", label: "Set it up", kind: "primary" },
          { id: "setup.all", label: "Use all 3 suggestions", kind: "secondary" },
          { id: "setup.no", label: "No", kind: "secondary" },
        ],
        dedupeKey: p.key,
        createdAt: NOW,
      },
    });
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `use-all-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    await card(goal);
    await card(food);
    await card(fun);
    await client.suggestion.create({
      data: {
        userId,
        key: "safe_to_spend:emergency_fund",
        capability: "safe_to_spend",
        topic: "emergency_fund",
        title: "Build a cushion for emergencies",
        worthCents: 150_700,
        worthKind: "risk",
        confidencePercent: 56,
        confidenceReason: "three months of data",
        urgency: "soon",
        why: "",
        actionLabel: "Set a savings goal",
        actionHref: "/goals",
        status: "selected",
        selectedOn: new Date("2026-11-15T00:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("counts the two cards shown", async () => {
    const open = (
      await client.janeMessage.findMany({
        where: { userId, status: "open" },
        select: MESSAGE_SELECT,
      })
    ).map(toChatMessage);
    const shown = await stillTrue(userId, open, { client, now: NOW });
    expect(shown.map((m) => m.refs.proposalKey).sort()).toEqual([
      "budget:Entertainment",
      "budget:Food and drink",
    ]);
    for (const m of shown) {
      expect(m.actions.find((a) => a.id === "setup.all")?.label).toBe("Use all 2 suggestions");
    }
  });

  it("sets up those two, not the goal it didn't show", async () => {
    const foodCard = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: food.key },
    });
    const { message } = await takeChatAction(userId, foodCard.id, "setup.all", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toBe("Done. I set up 2 suggestions.");
    const goalRow = await client.planProposal.findFirstOrThrow({
      where: { userId, key: goal.key },
    });
    expect(goalRow.status).toBe("open");
  });
});
