import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { creditGoalSource } from "@/lib/jane-agent/sources/credit-goal";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  CreditGoalError,
  completeGoalItems,
  endCreditGoal,
  loadCreditGoals,
  planFor,
  startCreditGoal,
} from "./credit-goals";
import { pullCredit } from "./credit";
import { demoCredit } from "./credit/demo";

// Spec step 227 against a real, migrated Postgres, on the demo bank (a stand-in score of 705
// with $2,410.50 on an $8,000 card limit): a plan for a target score and date from the
// score simulator, whose months reach the target, with a checklist for each month; and a
// plan that can't reach it says so.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "a credit score for a goal against a real database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("The demo bank must never call Plaid");
        },
      },
    ) as PlaidApi;
    let tick = 0;
    const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
    const opts = (now = LINKED) => ({ client, now });
    async function person(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      return user.id;
    }
    async function demoPerson(prefix: string) {
      const id = await person(prefix);
      const { itemId } = await linkDemoBank(id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      await pullCredit(id, opts());
      return id;
    }

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("plans a reachable score month by month, and the months reach it in the simulator", async () => {
      const id = await demoPerson("goal-plan");
      const view = (await planFor(
        id,
        { kind: "mortgage", targetScore: 740, targetDate: "2027-04-18" },
        opts(),
      ))!;
      expect(view.scoreNow).toBe(705);
      expect(view.months).toBe(6);
      expect(view.plan.reaches).toBe(true);
      // The last month's score is the simulator's own estimate for the balance then left.
      const last = view.plan.months.at(-1)!;
      const request = (await client.creditReport.findFirstOrThrow({ where: { userId: id } }))
        .inputs as never;
      expect(await demoCredit.estimate(request, { cardBalanceCents: last.balanceAfterCents })).toBe(
        last.projectedScore,
      );
      expect(last.projectedScore).toBeGreaterThanOrEqual(740);
      // A mortgage plan ends with a rapid rescore.
      expect(last.items.some((i) => i.key === "rescore")).toBe(true);
      expect(view.plan.months.every((m) => m.items.some((i) => i.key === "no_inquiry"))).toBe(true);
    });

    it("says when the target can't be reached, and what the best is", async () => {
      const id = await demoPerson("goal-short");
      const view = (await planFor(
        id,
        { kind: "car", targetScore: 820, targetDate: "2027-01-18" },
        opts(),
      ))!;
      expect(view.plan.reaches).toBe(false);
      expect(view.plan.best).toBeLessThan(820);
      expect(view.plan.best).toBeGreaterThan(705);
    });

    it("previews in the chat, starts the plan on a tap, once, and ticks off a month", async () => {
      const id = await demoPerson("goal-chat");
      const { reply } = await sendToJane(
        id,
        "I need a 740 credit score for a mortgage in 6 months",
        {
          client,
          now: later(),
        },
      );
      expect(reply.body).toMatch(
        /^You can reach a 740 by Apr 18, 2027: the plan takes your score from 705 to about \d+ in 6 months\./,
      );
      expect(reply.body).toContain("estimates from the stand-in score's simulator");
      expect(parseActions(reply.actions)[0].id).toBe("creditgoal.start");
      expect(await client.creditGoal.count({ where: { userId: id } })).toBe(0);
      const tapped = await takeChatAction(id, reply.id, "creditgoal.start", {
        client,
        now: later(),
      });
      expect(tapped.message.refs.note).toMatch(
        /^Started: A 740 score for a mortgage by Apr 18, 2027\./,
      );
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        { type: "user", id },
        "credit_goal_started",
        expect.objectContaining({ type: "credit_goal" }),
        { kind: "mortgage", target: 740 },
      );
      await expect(
        startCreditGoal(
          id,
          { kind: "mortgage", targetScore: 750, targetDate: "2027-04-18" },
          opts(),
        ),
      ).rejects.toThrow(CreditGoalError);
      const data = await loadCreditGoals(id, opts());
      expect(data.goals).toHaveLength(1);
      const goal = data.goals[0];
      expect(goal.thisMonth.map((i) => i.key)).toEqual([
        "pay",
        "keep_open",
        "no_inquiry",
        "on_time",
      ]);
      const snapshot = (await loadSnapshot(id, opts()))!;
      const month = creditGoalSource
        .gather(snapshot, context)
        .find((c) => c.dedupeKey.startsWith("creditgoal:"))!;
      expect(month.body).toContain("this month's list (2026-10):");
      expect(month.actions[0]).toMatchObject({ id: "creditgoal.done" });
      // Tick off one item, then the rest from the chat's button.
      expect(await completeGoalItems(id, goal.id!, ["pay"], opts())).toBe(1);
      await expect(completeGoalItems(id, goal.id!, ["pay"], opts())).rejects.toThrow(
        CreditGoalError,
      );
      const { reply: plan } = await sendToJane(id, "what's my credit plan?", {
        client,
        now: later(),
      });
      expect(plan.body).toMatch(/^A 740 score for a mortgage by Apr 18, 2027: you're at 705\./);
      expect(plan.body).not.toContain("Pay $");
      const ticked = await takeChatAction(id, plan.id, "creditgoal.done", { client, now: later() });
      expect(ticked.message.refs.note).toBe("Ticked off 3 items for this month.");
      expect((await loadCreditGoals(id, opts())).goals[0].thisMonth.every((i) => i.done)).toBe(
        true,
      );
      const tool = JSON.parse((await runChatTool(id, "credit_goals", {}, opts())).content);
      expect(tool.estimatesFromAStandInSimulator).toBe(true);
      expect(tool.plans[0].reachesTarget).toBe(true);
      await endCreditGoal(id, goal.id!, opts());
      expect((await loadCreditGoals(id, opts())).goals).toEqual([]);
    });

    it("refuses a bad score or date, and a real account has no plan", async () => {
      const id = await demoPerson("goal-bad");
      await expect(
        startCreditGoal(id, { kind: "car", targetScore: 900, targetDate: "2027-04-18" }, opts()),
      ).rejects.toThrow(CreditGoalError);
      await expect(
        startCreditGoal(id, { kind: "car", targetScore: 740, targetDate: "2026-01-01" }, opts()),
      ).rejects.toThrow(CreditGoalError);
      await expect(
        startCreditGoal(id, { kind: "boat", targetScore: 740, targetDate: "2027-04-18" }, opts()),
      ).rejects.toThrow(CreditGoalError);
      const realId = await person("goal-real");
      expect((await loadCreditGoals(realId, opts())).available).toBe(false);
      const { reply } = await sendToJane(realId, "I need a 740 credit score in 6 months", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^Planning a credit score needs a credit partner/);
    });
  },
);
