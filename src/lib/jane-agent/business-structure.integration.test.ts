import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadBusinessStructure } from "@/lib/business-structure";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 267 against a real, migrated Postgres: a demo-bank person who freelances. At a
// small profit an S corporation is not worth it; at a big one it is, and Jane says so once,
// with the numbers, to be confirmed by a tax professional.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "business owners' tax structure against a real database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("no plaid");
        },
      },
    ) as PlaidApi;

    async function freelancer(prefix: string, paymentCents: number, dropSalary = false) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      // Someone who also has a job already paid Social Security tax on it, which shrinks what an
      // S corporation can save; the big-profit case is a business owner with no other job.
      if (dropSalary) {
        await client.transaction.deleteMany({
          where: { userId: user.id, pfcDetailed: "INCOME_SALARY" },
        });
      }
      const checking = await client.account.findFirstOrThrow({
        where: { userId: user.id, subtype: "checking" },
      });
      await client.transaction.createMany({
        data: ["2026-02-10", "2026-04-10", "2026-06-10", "2026-08-10", "2026-10-10"].map((d) => ({
          userId: user.id,
          accountId: checking.id,
          source: "plaid" as const,
          date: new Date(`${d}T00:00:00Z`),
          amountCents: -paymentCents,
          description: "UPWORK ESCROW",
          merchantName: "Upwork",
          pfcDetailed: "INCOME_CONTRACTOR",
        })),
      });
      return user.id;
    }
    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("says an S corporation isn't worth it at a small profit, and what the QBI deduction is", async () => {
      const userId = await freelancer("biz-small", 800_000);
      const v = await loadBusinessStructure(userId, { client, now: LINKED });
      expect(v.active).toBe(true);
      expect(v.structure!.sCorp.worthIt).toBe(false);
      expect(v.structure!.sole.qbiCents).toBeGreaterThan(0);
      const candidates = taxesSource.gather(
        (await loadSnapshot(userId, { client, now: LINKED }))!,
        context,
      );
      expect(candidates.some((c) => c.dedupeKey.startsWith("business:"))).toBe(false);
      const { reply } = await sendToJane(userId, "should I become an S corp", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/^Here is where your business taxes stand\./);
      expect(reply.body).toContain("An S corporation wouldn't save enough after its costs");
      expect(reply.body).toContain("qualified business income deduction is about");
    });

    it("brings the S corporation up once, with numbers, at a big profit, and gives Claude the figures", async () => {
      const userId = await freelancer("biz-big", 2_500_000, true);
      const candidate = taxesSource
        .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
        .find((c) => c.dedupeKey.startsWith("business:"))!;
      expect(candidate.body).toMatch(
        /^At your profit of \$[\d,]+, running your business as an S corporation could save about \$[\d,]+ a year in tax after about \$[\d,]+ of payroll and filing costs\./,
      );
      expect(candidate.body).toContain("A tax professional should confirm it");
      expect(candidate.refs.advice).toBe(true);
      const tool = JSON.parse(
        (await runChatTool(userId, "tax_business", {}, { client, now: LINKED })).content,
      );
      expect(tool.sCorporation.worthIt).toBe(true);
      expect(tool.sCorporation.salaryRange).toHaveLength(2);
      expect(tool.soleProprietor.qbiDeduction).toMatch(/^\$/);
    });

    it("doesn't raise it for someone whose job already pays the Social Security tax, even at a big profit", async () => {
      const userId = await freelancer("biz-job", 3_000_000);
      const v = await loadBusinessStructure(userId, { client, now: LINKED });
      expect(v.structure!.profitCents).toBeGreaterThan(15_000_000);
      expect(v.structure!.sCorp.worthIt).toBe(false);
    });

    it("has nothing to compare without self-employment profit", async () => {
      const user = await client.user.create({
        data: { email: `biz-none-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      const v = await loadBusinessStructure(user.id, { client, now: LINKED });
      expect(v.structure).toBeNull();
      const { reply } = await sendToJane(user.id, "what is my qbi deduction", {
        client,
        now: LINKED,
      });
      expect(reply.body).toContain("I don't see profit from self-employment this year");
    });
  },
);
