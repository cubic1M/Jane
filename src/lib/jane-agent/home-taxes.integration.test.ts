import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { HomeTaxesError, loadHomeTaxes, saveHomeAnswers } from "@/lib/home-taxes";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { ITEMIZED } from "@/config/tax-rates";
import { figuresOf } from "@/planning/home-taxes";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 170 against a real, migrated Postgres: the demo person's home loan and a big
// property tax bill. The state and local tax cap is applied (in the estimate too), and
// every figure links to its transactions, loan or answers.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("homeowner taxes against a real database", { timeout: 60_000 }, () => {
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

  async function homeowner(prefix: string, propertyTaxCents: number) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    const bill = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-04-10T00:00:00Z"),
        amountCents: propertyTaxCents,
        description: "SANTA CLARA COUNTY TAX COLLECTOR",
        merchantName: null,
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      },
    });
    return { userId: user.id, billId: bill.id };
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

  it("applies the cap to income and property tax, in the estimate too", async () => {
    const { userId, billId } = await homeowner("home", 3_800_000);
    const view = await loadHomeTaxes(userId, { client, now: LINKED });
    expect(view.homeowner).toBe(true);
    expect(view.mortgageInterest!.sources[0]).toMatchObject({
      kind: "loan",
      name: "Demo Home Loan",
    });
    expect(view.propertyTax).toMatchObject({
      cents: 3_800_000,
      sources: [{ kind: "transaction", id: billId, payee: "SANTA CLARA COUNTY TAX COLLECTOR" }],
    });
    expect(view.salt.capCents).toBe(ITEMIZED.saltCap.normal);
    expect(view.salt.totalCents).toBeGreaterThan(ITEMIZED.saltCap.normal);
    expect(view.salt.allowedCents).toBe(ITEMIZED.saltCap.normal);

    // The estimate counts the property tax as a deduction, capped, and not as tax paid.
    const estimate = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(estimate.input.otherStateLocalTaxCents).toBe(3_800_000);
    expect(estimate.input.stateEstimatedPaidCents).toBe(0);
    expect(estimate.estimate.deduction.itemized.stateLocalTaxCents).toBe(ITEMIZED.saltCap.normal);

    for (const f of figuresOf(view)) expect(f.sources.length, f.label).toBeGreaterThan(0);
  });

  it("says when the cap bites, once a year", async () => {
    const { userId } = await homeowner("home-cap", 3_800_000);
    const message = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === "salt:2026")!;
    expect(message.body).toMatch(
      /^Your state and local taxes for 2026 come to \$[\d,.]+: \$[\d,.]+ of income tax and \$38,000\.00 of property tax\. Only \$40,400\.00 counts if you itemize \(the state and local tax cap\), so \$[\d,.]+ doesn't\.$/,
    );
    const small = await homeowner("home-small", 400_000);
    expect(
      taxesSource
        .gather((await loadSnapshot(small.userId, { client, now: LINKED }))!, context)
        .some((c) => c.dedupeKey === "salt:2026"),
    ).toBe(false);
  });

  it("tracks a sale against the exclusion, checks the answers, and answers in the chat", async () => {
    const { userId } = await homeowner("home-sale", 400_000);
    await expect(
      saveHomeAnswers(
        userId,
        {
          points: null,
          sale: {
            boughtOn: "2020-01-01",
            priceCents: 1,
            soldOn: "2027-01-01",
            saleCents: 1,
            costsCents: 0,
            daysLivedIn: 0,
          },
        },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toBeInstanceOf(HomeTaxesError);
    await saveHomeAnswers(
      userId,
      {
        points: null,
        sale: {
          boughtOn: "2018-03-01",
          priceCents: 60_000_000,
          soldOn: "2026-09-15",
          saleCents: 95_000_000,
          costsCents: 5_000_000,
          daysLivedIn: 1_826,
        },
      },
      { client, now: LINKED, via: "page" },
    );
    const view = await loadHomeTaxes(userId, { client, now: LINKED });
    expect(view.sale).toMatchObject({
      gainCents: 30_000_000,
      qualifies: true,
      exclusionCents: 25_000_000,
      taxableGainCents: 5_000_000,
    });
    const sale = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey.startsWith("homesale:2026"))!;
    expect(sale.body).toContain("about $50,000.00 is taxed as a long-term gain");

    const { reply } = await sendToJane(userId, "mortgage interest deduction on my taxes", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(
      /^Here is what your home changes on your 2026 taxes\.\n• Mortgage interest: \$[\d,.]+ \(from Demo Home Loan, as your lender reports it\)/,
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_home", {}, { client, now: LINKED })).content,
    );
    expect(tool.figures.every((f: { from: string[] }) => f.from.length > 0)).toBe(true);
    expect(tool.sale).toMatchObject({ qualifies: true, taxed: "$50,000.00" });
  });
});
