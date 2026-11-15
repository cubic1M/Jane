import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { BudgetProposal, GoalProposal } from "@/planning/proposals";
import { setupBody } from "./sources/setup";
import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// Debugger 11-15: a student's dock had "Build an emergency cushion, protect $1,674" (the scan's
// suggestion) and, three cards on, "I could start an 'Emergency fund' goal: $5,700.00 by November
// 2027": one goal, two cards, two numbers. A set-up goal card whose goal a suggestion already
// brings up is put away; a budget card stays.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-15T03:30:00Z");

const goal: GoalProposal = {
  kind: "goal",
  key: "goal:emergency_fund",
  name: "Emergency fund",
  targetCents: 570_000,
  targetDate: "2027-11-14",
  monthlySpendingCents: 189_700,
  basis: "3 months of your own average spending",
};
const budget: BudgetProposal = {
  kind: "budget",
  key: "budget:Food and drink",
  category: "Food and drink",
  amountCents: 36_000,
};

describe.runIf(url)("a set-up goal a suggestion already brings up", () => {
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
        actions: [{ id: "setup.yes", label: "Set it up", kind: "primary" }],
        dedupeKey: p.key,
        createdAt: NOW,
      },
    });
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `still-true-goal-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("puts away the emergency fund card and keeps the budget", async () => {
    await card(goal);
    const food = await card(budget);
    await client.suggestion.create({
      data: {
        userId,
        key: "safe_to_spend:emergency_fund",
        capability: "safe_to_spend",
        topic: "emergency_fund",
        title: "Build a cushion for emergencies",
        worthCents: 167_400,
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

    const open = (
      await client.janeMessage.findMany({
        where: { userId, status: "open" },
        select: MESSAGE_SELECT,
      })
    ).map(toChatMessage);
    const shown = await stillTrue(userId, open, { client, now: NOW });

    expect(shown.map((m) => m.id)).toEqual([food.id]);
  });
});
