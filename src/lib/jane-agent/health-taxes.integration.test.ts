import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadHealthTaxes } from "@/lib/health-taxes";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { correctFact } from "@/lib/profile";
import { runChatTool } from "./claude-tools";
import { parseTaxIntent } from "./tax-intents";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 269 against a real, migrated Postgres: a Marketplace plan's credit checked against
// the person's income (repaid in full over 400% of the poverty line, no cap from 2026), HSA
// deposits over the limit, and medical bills against the 7.5% floor: in the chat's messages,
// its answer and its tool, with the same figures.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe("the health tax questions people ask", () => {
  it.each([
    "do I have to pay back my marketplace subsidy",
    "will I owe the premium tax credit back",
    "did I put too much in my HSA",
    "can I deduct my medical bills",
    "is my hsa over the limit",
  ])("reads %j as the health tax question", (text) => {
    expect(parseTaxIntent(text.toLowerCase())).toEqual({ kind: "tax", ask: "health" });
  });

  it("leaves other health and tax questions to their own answers", () => {
    expect(parseTaxIntent("how much is in my HSA")).not.toEqual({ kind: "tax", ask: "health" });
    expect(parseTaxIntent("i inherited an ira")).toEqual({ kind: "tax", ask: "inherited" });
  });
});

describe.runIf(url)("health cover and taxes against a real database", { timeout: 120_000 }, () => {
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
    const row = (date: string, amountCents: number, description: string, pfc: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pfcDetailed: pfc,
        },
      });
    for (let m = 1; m <= 10; m++) {
      const mm = String(m).padStart(2, "0");
      await row(
        `2026-${mm}-03`,
        41_200,
        "HEALTHCARE.GOV MARKETPLACE",
        "GENERAL_SERVICES_INSURANCE",
      );
      await row(`2026-${mm}-12`, 50_000, "HSA BANK CONTRIBUTION", "TRANSFER_OUT_ACCOUNT_TRANSFER");
    }
    await row("2026-05-20", 2_500_000, "MERCY HOSPITAL BILLING", "MEDICAL_OTHER_MEDICAL");
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

  it("warns that a told advance credit would be repaid in full over 400%, and says it the same way everywhere", async () => {
    const userId = await person("hlt");
    await correctFact(userId, "marketplace_aptc_monthly", "200", { client, now: LINKED });
    const v = await loadHealthTaxes(userId, { client, now: LINKED });
    expect(v.advice).toBe(true);
    expect(v.marketplace).toMatchObject({ payments: 10, told: true, advanceYearCents: 240_000 });
    expect(v.marketplace.check).toMatchObject({ overCliff: true, repayCents: 240_000 });

    const ptc = (await candidates(userId)).find((c) => c.dedupeKey.startsWith("ptc:"))!;
    expect(ptc.kind).toBe("decision");
    expect(ptc.refs.advice).toBe(true);
    expect(ptc.body).toContain("Over 400% the Marketplace credit stops");
    expect(ptc.body).toContain("about $2,400 against $2,400 paid in advance");
    expect(ptc.body).toContain("no cap on paying it back");

    const tool = JSON.parse(
      (await runChatTool(userId, "tax_health", {}, { client, now: LINKED })).content,
    );
    expect(tool.marketplace).toMatchObject({
      overThe400PercentLine: true,
      advanceCredit: "$2,400.00",
      wouldBeRepaid: "$2,400.00",
      advanceCreditToldByPerson: true,
      repaymentCap: null,
    });

    const { reply } = await sendToJane(userId, "do I have to pay back my marketplace subsidy", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^Here is the tax side of your health cover\./);
    expect(reply.body).toContain("That's over 400%, where the credit stops");
  });

  it("catches HSA deposits over the limit and a hospital bill over the medical floor", async () => {
    const userId = await person("hlt-hsa");
    const v = await loadHealthTaxes(userId, { client, now: LINKED });
    expect(v.hsa).toMatchObject({ deposits: 10, contributedCents: 500_000, excessCents: 60_000 });
    expect(v.medical.spentCents).toBeGreaterThanOrEqual(2_500_000 + 10 * 41_200);
    expect(v.medical.deductibleCents).toBeGreaterThan(0);

    const all = await candidates(userId);
    const hsa = all.find((c) => c.dedupeKey.startsWith("hsa_excess:"))!;
    expect(hsa.kind).toBe("heads_up");
    expect(hsa.body).toMatch(/You've put \$5,000\.00 into your HSA this year, \$600\.00 over/);
    expect(hsa.body).toContain("return of excess contribution");

    const tool = JSON.parse(
      (await runChatTool(userId, "tax_health", {}, { client, now: LINKED })).content,
    );
    expect(tool.hsa).toMatchObject({ deposited: "$5,000.00", limit: "$4,400.00" });
    expect(tool.medical.paidThisYear).toBe(
      `$${(v.medical.spentCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    );

    const { reply } = await sendToJane(userId, "did I put too much in my HSA", {
      client,
      now: LINKED,
    });
    expect(reply.body).toContain("HSA: $5,000.00 in this year");
    expect(reply.body).toMatch(/Medical costs: \$[\d,.]+ so far/);
  });
});
