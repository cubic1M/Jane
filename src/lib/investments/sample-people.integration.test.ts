import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PEOPLE, type PersonId } from "@/config/people";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { loadRetirementIncome } from "./retirement-income";

// Gap audit (spec steps 129-132, 157 and 212) against a real, migrated Postgres: each sample
// person comes with their investor profile, so the portfolio review, rebalance plan, goal
// buckets and retirement planner answer with their own figures in Try Jane; the retiree's
// Social Security is the deposits in their account; and "when can I stop working" says how
// long the money lasts for someone near retirement.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60_000;

describe.runIf(url)(
  "the sample people's investing, from their profiles",
  { timeout: 60_000 },
  () => {
    let client: PrismaClient;
    const made = new Map<PersonId, string>();
    let tick = 0;
    const ask = async (id: PersonId, text: string) =>
      (
        await sendToJane(made.get(id)!, text, {
          client,
          now: new Date(NOW.getTime() + ++tick * MINUTE),
        })
      ).reply.body;

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      for (const p of PEOPLE) {
        const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
        await syncItem(trial.itemId, { client, now: NOW });
        made.set(p.id, trial.userId);
      }
    }, 300_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it.each(PEOPLE)("$id's profile is finished, and the tools work from it", async (person) => {
      const userId = made.get(person.id)!;
      const profile = JSON.parse(
        (await runChatTool(userId, "investor_profile", {}, { client, now: NOW })).content,
      );
      expect(JSON.stringify(profile)).not.toMatch(/isn't finished|not finished/i);
      const buckets = await ask(person.id, "how should I invest for my goals");
      expect(buckets).not.toMatch(/four quick answers|isn't finished/);
    });

    it("answers when preretire could stop working with how long the money lasts", async () => {
      const body = await ask("preretire", "when can I stop working");
      expect(body).toMatch(/^By 67 your retirement accounts could be about \$[\d,.]+ to \$[\d,.]+/);
      expect(body).toMatch(/your money would last to about age \d+/);
    });

    it("reads the retiree's Social Security from their deposits, and plans from today", async () => {
      const v = await loadRetirementIncome(made.get("retiree")!, { client, now: NOW });
      expect(v.ss.source).toBe("deposits");
      expect(v.ss.fullMonthlyCents).toBeGreaterThan(0);
      expect(v.ss.options).toEqual([]);
      expect(v.spendFrom).toBe("spending");
      expect(v.paycheck).not.toBeNull();
      const body = await ask("retiree", "when can I stop working");
      expect(body).toMatch(/^You're at or past 67: your retirement accounts hold \$[\d,.]+/);
      expect(body).not.toMatch(/catch-up|keep going as you are/i);
      expect(
        await ask("retiree", "how do I turn my savings into a paycheck in retirement"),
      ).toMatch(/a month coming in now \(from the deposits in your account\)/);
    });

    it("says when there's nothing invested to rebalance, and the review agrees with the trades", async () => {
      expect(await ask("freelancer", "should I rebalance")).toMatch(
        /^You don't have any investments to rebalance yet/,
      );
      // The renter's small account: off target, and the review says what the rebalance trades.
      const trades = await ask("renter", "should I rebalance");
      expect(trades).toMatch(/orders ready/);
      expect(await ask("renter", "review my portfolio")).toMatch(/What I'd change:/);
    });
  },
);
