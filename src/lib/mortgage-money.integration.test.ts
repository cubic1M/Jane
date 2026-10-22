import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { MortgageMoneyError, loadMortgageMoney } from "./mortgage-money";

// Spec step 246 against a real, migrated Postgres, on the demo bank (a $312,400 mortgage at
// 3.99%): a lump sum or extra money compared as extra principal, a recast and a refinance,
// with fees and the date each pays back, against investing it instead.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)(
  "recast, refinance or pay extra against a real database",
  { timeout: 30_000 },
  () => {
    let client: PrismaClient;
    let userId: string;
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

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const user = await client.user.create({
        data: { email: `mm-${crypto.randomUUID()}@example.com` },
      });
      userId = user.id;
      created.push(userId);
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("compares a lump sum three ways with fees and a pay-back date", async () => {
      const v = await loadMortgageMoney(userId, { lumpCents: 2_000_000 }, opts());
      expect(v).toMatchObject({
        available: true,
        advice: true,
        balanceCents: 31_240_000,
        aprBps: 399,
      });
      const r = v.result!;
      const [extra, recast, refi] = r.options;
      expect(extra.interestSavedCents).toBeGreaterThan(recast.interestSavedCents);
      expect(recast).toMatchObject({ available: true, feeCents: 25_000 });
      expect(recast.paymentCents).toBeLessThan(r.baseline.paymentCents);
      expect(recast.breakEvenOn! > "2026-10-18").toBe(true);
      // A 3.99% mortgage: no catalog offer is under it.
      expect(refi.available).toBe(false);
      expect(r.invest.putCents).toBe(2_000_000);
    });

    it("answers in the chat with both sides, and gives Claude the same figures", async () => {
      const { reply } = await sendToJane(userId, "I have $20,000, should I recast my mortgage", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^With \$20,000\.00, the way that saves the most interest is /);
      expect(reply.body).toContain("Recast the mortgage");
      expect(reply.body).toContain("Investing it instead");
      expect(reply.body).toContain("pays back in");
      expect(parseRefs(reply.refs).advice).toBe(true);
      const monthly = await sendToJane(userId, "should I put $500 a month toward my mortgage", {
        client,
        now: later(),
      });
      expect(monthly.reply.body).toMatch(/^With \$500\.00 a month, /);
      const tool = JSON.parse(
        (await runChatTool(userId, "mortgage_money", { lump_cents: 2_000_000 }, opts())).content,
      );
      expect(tool.options).toHaveLength(3);
      expect(tool.investingInstead.notGuaranteed).toBe(true);
      expect(tool.options[1].feePaysBackInMonths).toBeGreaterThan(0);
      const empty = await sendToJane(userId, "recast vs refinance", { client, now: later() });
      expect(empty.reply.body).toMatch(/^Tell me how much/);
    });

    it("refuses an amount that is too small or pays the loan off, and has nothing without a mortgage", async () => {
      await expect(loadMortgageMoney(userId, { lumpCents: 5_000 }, opts())).rejects.toThrow(
        MortgageMoneyError,
      );
      await expect(loadMortgageMoney(userId, { lumpCents: 40_000_000 }, opts())).rejects.toThrow(
        "pay it off",
      );
      const user = await client.user.create({
        data: { email: `mm-none-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      expect((await loadMortgageMoney(user.id, { lumpCents: 2_000_000 }, opts())).available).toBe(
        false,
      );
      const { reply } = await sendToJane(user.id, "should I recast my mortgage", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^I don't see a mortgage/);
    });
  },
);
