import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadSideIncome, saveSideIncomeAnswers, SideIncomeError } from "@/lib/side-income";
import { loadSelfEmployed } from "@/lib/self-employed";
import { collectTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxPack } from "@/lib/tax-pack";
import { taxPackCsv } from "@/planning/tax-pack";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 173 against a real, migrated Postgres: a rental (rent, tagged expenses,
// depreciation) and a gig platform's payouts matched to its 1099, in the estimate, the
// quarterly amounts and the pack.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const FEB = new Date("2027-02-10T16:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("side income and rentals against a real database", { timeout: 60_000 }, () => {
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
    const add = (date: string, cents: number, name: string, pfc: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents: cents,
          description: name,
          merchantName: name,
          pfcDetailed: pfc,
        },
      });
    // Rent in (negative is money in), a repair, and two months of gig payouts.
    for (const m of ["03", "04", "05", "06", "07", "08", "09"]) {
      await add(`2026-${m}-01`, -200_000, "SUNSET PROPERTY TENANT", "INCOME_RENTAL");
    }
    const repair = await add(
      "2026-06-10",
      80_000,
      "ACE PLUMBING",
      "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
    );
    for (const m of ["05", "06", "07", "08"]) {
      await add(`2026-${m}-15`, -150_000, "ROADRUNNER RIDES", "INCOME_GIG_ECONOMY");
    }
    return { userId: user.id, repairId: repair.id };
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

  it("counts rent less tagged expenses and depreciation, in the estimate and the pack", async () => {
    const { userId, repairId } = await person("side");
    const before = await loadSideIncome(userId, { client, now: LINKED });
    expect(before.rental).toMatchObject({
      rentCents: 1_400_000,
      expensesCents: 0,
      depreciationCents: 0,
    });

    await client.taxTag.create({
      data: { userId, transactionId: repairId, merchantKey: "ace plumbing", tag: "rental" },
    });
    await saveSideIncomeAnswers(
      userId,
      { rental: { priceCents: 30_000_000, placedOn: "2026-03-01" }, kind: null },
      { client, now: LINKED, via: "page" },
    );
    const view = await loadSideIncome(userId, { client, now: LINKED });
    // $240,000 of building, March: 2.879%.
    expect(view.rental!.depreciation).toMatchObject({
      buildingCents: 24_000_000,
      percent: 0.02879,
    });
    expect(view.rental).toMatchObject({
      rentCents: 1_400_000,
      expensesCents: 80_000,
      depreciationCents: 690_960,
      netCents: 1_400_000 - 80_000 - 690_960,
      countedCents: 629_040,
    });
    expect(view.rental!.expenseRows.map((e) => e.id)).toEqual([repairId]);

    const estimate = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(
      estimate.assumptions.some((a) =>
        /^Your rental: rent less expenses and depreciation comes to \$[\d,.]+\.$/.test(a),
      ),
    ).toBe(true);
    // Rent is projected over the year; the net feeds the estimate.
    expect(estimate.input.income.rentalCents).toBeGreaterThan(0);

    // On the quarterly plan, and in the pack.
    expect((await loadSelfEmployed(userId, { client, now: LINKED })).active).toBe(true);
    const pack = await loadTaxPack(userId, 2026, { client, now: LINKED });
    expect(pack.rental).toEqual({
      rentCents: 1_400_000,
      expensesCents: 80_000,
      depreciationCents: 690_960,
      netCents: 629_040,
    });
    expect(pack.preparer.rental.rows.map((r) => r.id)).toEqual([repairId]);
    expect(taxPackCsv(pack)).toContain("Rental property,,Depreciation,6909.60,");

    await expect(
      saveSideIncomeAnswers(
        userId,
        { rental: { priceCents: 0, placedOn: "2026-03-01" }, kind: null },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toBeInstanceOf(SideIncomeError);
  });

  it("matches a platform's payouts to the 1099 it sent", async () => {
    const { userId } = await person("side-1099");
    expect((await loadSideIncome(userId, { client, now: FEB })).platforms).toEqual([
      expect.objectContaining({
        payer: "ROADRUNNER RIDES",
        payoutsCents: 600_000,
        status: "waiting",
      }),
    ]);
    await collectTaxDocuments(userId, { client, now: FEB, tick: false });
    const [platform] = (await loadSideIncome(userId, { client, now: FEB })).platforms;
    expect(platform).toMatchObject({
      payoutsCents: 600_000,
      formCents: 600_000,
      status: "matched",
    });

    // A payout the platform's form doesn't include: it differs.
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-09-15T00:00:00Z"),
        amountCents: -150_000,
        description: "ROADRUNNER RIDES",
        merchantName: "ROADRUNNER RIDES",
        pfcDetailed: "INCOME_GIG_ECONOMY",
      },
    });
    expect((await loadSideIncome(userId, { client, now: FEB })).platforms[0]).toMatchObject({
      payoutsCents: 750_000,
      formCents: 600_000,
      status: "differs",
    });
  });

  it("asks hobby or business with both taxes shown, and a hobby changes the estimate", async () => {
    const { userId } = await person("side-hobby");
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === "sidekind:2026")!;
    expect(candidate.body).toMatch(/federal tax about \$[\d,]+ as a business, \$[\d,]+ as a hobby/);
    expect(candidate.refs.advice).toBe(true);
    const asBusiness = (await loadTaxEstimate(userId, { client, now: LINKED })).estimate;
    expect(asBusiness.selfEmploymentTaxCents).toBeGreaterThan(0);

    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    const after = (
      await takeChatAction(userId, message.id, "tax.side_hobby", { client, now: LINKED })
    ).message;
    expect(after.refs.note).toBe(
      "Got it: a hobby. Its income is taxed with no expenses and no self-employment tax.",
    );
    const asHobby = (await loadTaxEstimate(userId, { client, now: LINKED })).estimate;
    expect(asHobby.selfEmploymentTaxCents).toBe(0);
    expect(asHobby.totalIncomeCents).toBeGreaterThan(0);
    // Asked once.
    expect(
      taxesSource
        .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
        .some((c) => c.dedupeKey === "sidekind:2026"),
    ).toBe(false);
  });

  it("answers my rental income, and gives Claude the side income", async () => {
    const { userId } = await person("side-chat");
    const { reply } = await sendToJane(userId, "what are the taxes on my rental income", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^Your side income for 2026:\n• Rental: \$14,000\.00 in/);
    expect(reply.body).toContain("• ROADRUNNER RIDES: $6,000.00 paid out, waiting for its 1099.");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_side_income", {}, { client, now: LINKED })).content,
    );
    expect(tool.rental.rentIn).toBe("$14,000.00");
    expect(tool.platforms[0]).toMatchObject({ platform: "ROADRUNNER RIDES", status: "waiting" });
  });
});
