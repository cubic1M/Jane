import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { bnplSource } from "@/lib/jane-agent/sources/bnpl";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { BnplError, loadBnpl, payOffPlan, warnNewPlan } from "./bnpl";

// Spec step 176 against a real, migrated Postgres, on the demo bank (Klarna Pay in 4 and an
// Affirm monthly plan): every installment from the plans' own schedules, the ones the
// forecast misses taken off safe to spend, a warning before a new plan strains the month,
// and a Pay in 4 plan paid off early (free) only on a tap.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "buy now, pay later under control against a real database",
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
    const opts = () => ({ client, now: LINKED });
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

    it("lists every installment from the plans' schedules, soonest first, matching each plan", async () => {
      const id = await demoPerson("bnpl-list");
      const data = await loadBnpl(id, opts());
      expect(data.plans.map((p) => p.name).sort()).toEqual(["Affirm plan", "Klarna Pay in 4"]);
      const klarna = data.plans.find((p) => p.name.startsWith("Klarna"))!;
      const affirm = data.plans.find((p) => p.name.startsWith("Affirm"))!;
      expect(klarna.paymentCents).toBe(6_225);
      expect(affirm.paymentCents).toBe(8_950);
      const dates = data.installments.map((i) => i.date);
      expect([...dates].sort()).toEqual(dates);
      for (const i of data.installments) {
        expect(i.cents).toBe(i.name.startsWith("Klarna") ? 6_225 : 8_950);
      }
      // A Pay in 4 plan stops when it's paid: no more than its remaining payments.
      const left = Math.ceil(klarna.balanceCents! / 6_225);
      expect(
        data.installments.filter((i) => i.name.startsWith("Klarna")).length,
      ).toBeLessThanOrEqual(left);
      expect(data.installments.length).toBeGreaterThan(0);
    });

    it("answers what's coming in the chat, with the installments listed", async () => {
      const id = await demoPerson("bnpl-ask");
      const { reply } = await sendToJane(id, "what buy now pay later payments do I have coming?", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(
        /^You have 2 buy now, pay later plans, with \$[\d,.]+ in installments over the next month\./,
      );
      expect(reply.body).toMatch(/- \w{3} \d+: \$[\d,.]+ to /);
      const tool = JSON.parse((await runChatTool(id, "bnpl_installments", {}, opts())).content);
      expect(tool.plans).toHaveLength(2);
      expect(tool.alwaysNeedsATap).toBe("paying a plan off");
    });

    it("warns before a new plan would strain the month, from the checking forecast", async () => {
      const id = await demoPerson("bnpl-warn");
      const data = await loadBnpl(id, opts());
      expect(data.forecastDays.length).toBeGreaterThan(20);
      const small = warnNewPlan(data, 4_000)!;
      expect(small.installments).toHaveLength(4);
      const huge = warnNewPlan(data, 2_000_000)!;
      expect(huge.strained).toBe(true);
      const { reply } = await sendToJane(id, "can I afford a $20000 Klarna plan?", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(
        /^A \$20,000\.00 Pay in 4 plan means four payments of \$5,000\.00 two weeks apart\./,
      );
      expect(reply.body).toMatch(/under the \$100\.00 I like to keep/);
      const { reply: ask } = await sendToJane(id, "can I afford a Klarna plan?", {
        client,
        now: later(),
      });
      expect(ask.body).toMatch(/^How much is the plan\?/);
    });

    it("offers to pay a Pay in 4 plan off for free, and pays only on the tap, once", async () => {
      const id = await demoPerson("bnpl-payoff");
      const data = await loadBnpl(id, opts());
      const klarna = data.plans.find((p) => p.name.startsWith("Klarna"))!;
      expect(klarna.freePayoff).toBe(true);
      // Monthly plans are never called free.
      expect(data.plans.find((p) => p.name.startsWith("Affirm"))!.freePayoff).toBe(false);
      expect(klarna.canCoverPayoff).toBe(true);
      const snapshot = (await loadSnapshot(id, opts()))!;
      const offer = bnplSource
        .gather(snapshot, context)
        .find((c) => c.dedupeKey.startsWith("bnpl_payoff:"))!;
      expect(offer.body).toMatch(/costs nothing extra/);
      expect(offer.actions[0]).toMatchObject({ id: "bnpl.payoff" });
      expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
      const { reply } = await sendToJane(id, "what buy now pay later payments do I have coming?", {
        client,
        now: later(),
      });
      const tapped = await takeChatAction(id, reply.id, "bnpl.payoff", { client, now: later() });
      expect(tapped.message.refs.note).toMatch(
        /^Scheduled: \$[\d,.]+ to pay off the Klarna Pay in 4\./,
      );
      const transfer = await client.moneyTransfer.findFirstOrThrow({ where: { userId: id } });
      expect(transfer).toMatchObject({ purpose: "debt", by: "person", toAccountId: null });
      await expect(payOffPlan(id, klarna.key, opts())).rejects.toThrow(BnplError);
    });

    it("never moves money or lists plans for a real account", async () => {
      const realId = await person("bnpl-real");
      const data = await loadBnpl(realId, opts());
      expect(data.plans).toEqual([]);
      await expect(payOffPlan(realId, "bnpl:klarna:6225", opts())).rejects.toThrow(BnplError);
      expect(await client.moneyTransfer.count({ where: { userId: realId } })).toBe(0);
    });
  },
);
