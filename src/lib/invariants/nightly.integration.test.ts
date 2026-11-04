import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { PrismaClient } from "@/generated/prisma/client";
import { runInvariants } from "./nightly";

// The nightly checks against a real, migrated Postgres: each one trips on the row it's about, a
// sample person is never counted, and nothing from a row comes back.
const url = process.env.TEST_DATABASE_URL;

const SECRET = "ZORBLAX PRIVATE MERCHANT";
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

describe.runIf(url)("the nightly invariants", () => {
  let client: PrismaClient;
  let userId = "";
  let checking = "";
  let card = "";
  const trialId = `${TRIAL_ID_PREFIX}invariants-${crypto.randomUUID()}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.user.create({ data: { id: trialId, email: `${trialId}@example.com` } });
  });
  beforeEach(async () => {
    const user = await client.user.create({
      data: { email: `invariants-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const account = (type: string, name: string) =>
      client.account.create({ data: { userId, source: "csv", name, type } });
    checking = (await account("depository", "Checking")).id;
    card = (await account("credit", "Card")).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { startsWith: "invariants-" } } });
    await client.user.deleteMany({ where: { id: trialId } });
    await client.$disconnect();
  });

  const row = (over: Record<string, unknown> & { accountId: string; amountCents: number }) =>
    client.transaction.create({
      data: {
        userId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: day(20),
        description: SECRET,
        merchantName: SECRET,
        ...over,
      },
    });
  const finding = (over: Record<string, unknown>) =>
    client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: `merchant:${crypto.randomUUID()}`,
        title: SECRET,
        confidence: "low",
        ...over,
      },
    });

  it("names a question with dollars on it, and doesn't call an answered one broken", async () => {
    const evidence = { onlyItsPrice: true, annualCostCents: 110_400 };
    const before = await runInvariants({ client });
    await finding({ annualSavingsCents: null, evidence });
    expect((await runInvariants({ client })).findings.questionWithDollars).toBe(
      before.findings.questionWithDollars,
    );
    await finding({ annualSavingsCents: 110_400, evidence, status: "approved" });
    expect((await runInvariants({ client })).findings.questionWithDollars).toBe(
      before.findings.questionWithDollars,
    );
    await finding({ annualSavingsCents: 110_400, evidence });
    const after = await runInvariants({ client });
    expect(after.findings.questionWithDollars).toBe(before.findings.questionWithDollars + 1);
    expect(after.broken).toContain("questionWithDollars");
  });

  it("recomputes a fee finding from the rows it lists, and those from what's stored", async () => {
    const fee = await row({ accountId: checking, amountCents: 3400 });
    const listed = { id: fee.id, amountCents: 3400 };
    const before = await runInvariants({ client });
    await finding({
      type: "bank_fees",
      amountCents: 3400,
      annualSavingsCents: 3400,
      evidence: { transactions: [listed] },
    });
    let now = await runInvariants({ client });
    expect(now.findings.feeTotalOffItsRows).toBe(before.findings.feeTotalOffItsRows);
    expect(now.findings.restsOnMissingRows).toBe(before.findings.restsOnMissingRows);

    await finding({
      type: "bank_fees",
      amountCents: 9999,
      annualSavingsCents: 9999,
      evidence: { transactions: [listed] },
    });
    now = await runInvariants({ client });
    expect(now.findings.feeTotalOffItsRows).toBe(before.findings.feeTotalOffItsRows + 1);
    expect(now.broken).toContain("feeTotalOffItsRows");

    await finding({
      type: "bank_fees",
      amountCents: 3500,
      annualSavingsCents: 3500,
      evidence: { transactions: [{ id: "gone", amountCents: 3500 }] },
    });
    now = await runInvariants({ client });
    expect(now.findings.restsOnMissingRows).toBe(before.findings.restsOnMissingRows + 1);
  });

  it("counts a card payment with no other side, once it's had time to post", async () => {
    const pay = {
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    };
    const before = (await runInvariants({ client })).cardPayments;
    await row({ accountId: card, amountCents: 500, date: day(21) });
    await row({ accountId: checking, amountCents: 40_000, ...pay });
    await row({ accountId: card, amountCents: -40_000, date: day(19), ...pay });
    let now = (await runInvariants({ client })).cardPayments;
    expect(now.legs).toBe(before.legs + 1);
    expect(now.unmatched).toBe(before.unmatched);

    await row({ accountId: checking, amountCents: 41_000, ...pay });
    now = (await runInvariants({ client })).cardPayments;
    expect(now.unmatched).toBe(before.unmatched + 1);

    await row({ accountId: checking, amountCents: 42_000, date: day(2), ...pay });
    expect((await runInvariants({ client })).cardPayments.unmatched).toBe(now.unmatched);
  });

  it("counts old rows that break a NOT VALID money rule, by its name", async () => {
    const summary = await runInvariants({ client });
    expect(summary.constraints.unvalidated).toBeGreaterThan(0);
    // A rule of this test's own, so that the real ones stay in place for tests running beside it.
    await client.budget.create({ data: { userId, category: "Food", amountCents: 7777 } });
    await client.$executeRaw`ALTER TABLE budgets ADD CONSTRAINT ck_invariants_test CHECK (amount_cents <> 7777) NOT VALID`;
    try {
      const now = await runInvariants({ client });
      expect(now.constraints.oldRows.ck_invariants_test).toBe(1);
      expect(now.constraints.unvalidated).toBe(summary.constraints.unvalidated + 1);
    } finally {
      await client.$executeRaw`ALTER TABLE budgets DROP CONSTRAINT ck_invariants_test`;
    }
  });

  it("leaves sample people out, and returns nothing from a row", async () => {
    const before = await runInvariants({ client });
    await client.finding.create({
      data: {
        userId: trialId,
        type: "subscription_review",
        key: "merchant:x",
        title: SECRET,
        confidence: "low",
        annualSavingsCents: -5,
      },
    });
    const now = await runInvariants({ client });
    expect(now.findings.negativeSaving).toBe(before.findings.negativeSaving);
    const said = JSON.stringify(now);
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain(userId);
    expect(said).not.toContain("@example.com");
    // Every value in it is a count, or the fixed name of a check or rule.
    const walk = (v: unknown): void => {
      if (typeof v === "number") return;
      if (typeof v === "string") return void expect(v).toMatch(/^[A-Za-z_]+$/);
      if (Array.isArray(v)) return v.forEach(walk);
      Object.values(v as object).forEach(walk);
    };
    walk(now);
  });
});
