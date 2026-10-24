import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadRetirementIncome } from "@/lib/investments/retirement-income";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { correctFact } from "@/lib/profile";
import { loadRetirementTaxes } from "@/lib/retirement-taxes";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseTaxIntent } from "./tax-intents";
import { sendToJane } from "./typing";

// Spec step 271 against a real, migrated Postgres: Social Security's taxable part (and the
// withholding nothing does), Medicare's surcharge line two years ahead once the person is near
// Medicare, and the order to draw tuned to stay under it, handed to the investing side's
// retirement paycheck: the same figures in the message, the answer, the tool and the page's view.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe("the retirement tax questions people ask", () => {
  it.each([
    "is my social security taxed",
    "what is irmaa",
    "will my medicare premiums go up with a roth conversion",
    "which account should i withdraw from first for taxes",
    "how much tax on social security",
  ])("reads %j as the retirement tax question", (text) => {
    expect(parseTaxIntent(text)).toEqual({
      kind: "tax",
      ask: "retirement",
      // Naming Medicare or IRMAA asks the answer to explain the surcharge (answer-check sweep).
      ...(/irmaa|medicare/.test(text) ? { medicare: true } : {}),
    });
  });
});

describe.runIf(url)(
  "taxes on retirement income against a real database",
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

    async function person(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      const checking = await client.account.findFirstOrThrow({
        where: { userId: user.id, subtype: "checking" },
      });
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2025, 10 + m, 3));
        await client.transaction.create({
          data: {
            userId: user.id,
            accountId: checking.id,
            source: "plaid",
            date: d,
            amountCents: -268_000,
            description: "SSA TREAS 310 XXSOC SEC",
            pfcDetailed: "INCOME_OTHER",
          },
        });
      }
      return user.id;
    }
    const candidates = async (userId: string) =>
      taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, context);

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

    it("works out Social Security's taxable part and says nothing withholds it", async () => {
      const userId = await person("ret");
      const v = await loadRetirementTaxes(userId, { client, now: LINKED });
      expect(v.ssBenefitsCents).toBe(12 * 268_000);
      expect(v.ssDeposits).toBe(12);
      // With working income on top, 85% of it is taxable.
      expect(v.ss.taxableCents).toBe(Math.round(0.85 * 12 * 268_000));

      const ss = (await candidates(userId)).find((c) => c.dedupeKey === "ss_tax:2026")!;
      expect(ss.kind).toBe("heads_up");
      expect(ss.body).toMatch(/^\$27,336 of your \$32,160 a year of Social Security is taxable/);
      expect(ss.body).toContain("Form W-4V");

      const tool = JSON.parse(
        (await runChatTool(userId, "tax_retirement", {}, { client, now: LINKED })).content,
      );
      expect(tool.socialSecurity).toMatchObject({
        benefitsAYear: "$32,160.00",
        taxable: "$27,336.00",
      });
      expect(tool.medicareSurcharge.setsPremiumsFor).toBe(2028);

      const { reply } = await sendToJane(userId, "is my social security taxed", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/^Here is how your retirement income is taxed\./);
      expect(reply.body).toContain("$27,336.00 of it is taxable");
    });

    it("near Medicare: the line two years ahead, the tuned order, and the paycheck gets it", async () => {
      const userId = await person("ret-irmaa");
      await correctFact(userId, "age", "64", { client, now: LINKED });
      const v = await loadRetirementTaxes(userId, { client, now: LINKED });
      expect(v.nearMedicare).toBe(true);
      expect(v.irmaa).toMatchObject({ premiumYear: 2028, estimated: true });

      const watch = (await candidates(userId)).find((c) => c.dedupeKey === "irmaa:2026")!;
      expect(watch.body).toContain("sets your Medicare premiums in 2028");
      expect(watch.refs.advice).toBe(true);
      expect(watch.body).toContain(
        "keep pre-tax withdrawals and conversions this year under about",
      );

      const paycheck = await loadRetirementIncome(userId, { client, now: LINKED });
      expect(paycheck.taxTuned).toMatchObject({
        premiumYear: 2028,
        linesEstimated: true,
        preTaxCapCents: v.tuned.preTaxCapCents,
        lineCents: v.irmaa.nextLineCents,
      });
    });
  },
);
