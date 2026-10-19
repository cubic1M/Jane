import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { encrypt } from "./crypto";
import { exportUserData } from "./data-export";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("data export against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];

  async function person(name: string) {
    const suffix = crypto.randomUUID();
    const user = await client.user.create({
      data: { email: `${name}-${suffix}@example.com`, mfaSecretEncrypted: encrypt("TOTPSECRET") },
    });
    ids.push(user.id);
    const userId = user.id;
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${suffix}`,
        accessTokenEncrypted: encrypt(`access-sandbox-${suffix}`),
        transactionsCursor: `cursor-${suffix}`,
        institutionName: `${name} Bank`,
      },
    });
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `acc-${suffix}`,
        name: `${name} checking`,
        type: "depository",
        subtype: "checking",
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "plaid",
        plaidTransactionId: `t-${suffix}`,
        date: new Date(),
        amountCents: 100,
        description: `${name} purchase`,
      },
    });
    await client.recurringStream.create({
      data: {
        userId,
        accountId: account.id,
        plaidStreamId: `s-${suffix}`,
        frequency: "MONTHLY",
        lastAmountCents: 1,
        averageAmountCents: 1,
        status: "MATURE",
      },
    });
    await client.liability.create({
      data: { userId, accountId: account.id, kind: "credit", aprBps: 2299 },
    });
    const finding = await client.finding.create({
      data: { userId, type: "bank_fees", key: "k", title: `${name} fees`, confidence: "high" },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: { title: "x" } },
    });
    await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "recover_bank_fees",
        notes: "TEAM-ONLY NOTE",
        failureReason: null,
      },
    });
    await client.digest.create({
      data: { userId, weekStart: new Date("2026-10-19"), payload: {} },
    });
    await client.membershipIntent.create({ data: { userId, kind: "reserve" } });
    await client.analyticsEvent.create({ data: { userId, name: "report_viewed" } });
    await client.merchantCategory.create({
      data: {
        userId,
        merchantKey: "m",
        pfcPrimary: "OTHER",
        pfcDetailed: "OTHER_OTHER",
        source: "llm",
      },
    });
    await client.subscriptionCheck.create({
      data: { userId, merchantKey: "m", isSubscription: true, model: "x", promptVersion: "v" },
    });
    await client.alert.create({
      data: { userId, type: "fee_charged", key: "tx_1", title: "Fee", body: "b" },
    });
    await client.budget.create({
      data: { userId, category: "Food and drink", amountCents: 40_000 },
    });
    await client.savingsGoal.create({
      data: { userId, name: "Trip", targetCents: 200_000, targetDate: new Date("2027-06-01") },
    });
    await client.balanceSnapshot.create({
      data: { userId, accountId: account.id, date: new Date("2026-10-01"), balanceCents: 100 },
    });
    await client.lifeEvent.create({
      data: { userId, kind: "moving", startedOn: new Date("2026-10-01"), checkedItems: ["mail"] },
    });
    await client.taxProfile.create({
      data: { userId, state: name === "me" ? "CA" : "TX", answered: ["state"] },
    });
    await client.taxTag.create({ data: { userId, merchantKey: `${name} merchant`, tag: "work" } });
    await client.taxForm.create({
      data: { userId, year: 2026, key: `w2:${name}`, receivedAt: new Date("2027-02-01") },
    });
    await client.janeMessage.create({
      data: { userId, kind: "brief", body: `${name} brief`, dedupeKey: "brief:2026-10-18" },
    });
    await client.askConversation.create({
      data: {
        userId,
        title: "Food spending?",
        messages: { create: [{ userId, role: "user", content: "Food spending?" }] },
      },
    });
    await client.session.create({
      data: { userId, sessionToken: `sess-${suffix}`, expires: new Date(Date.now() + 1e9) },
    });
    await client.ownedAsset.create({
      data: {
        userId,
        kind: "home",
        name: `${name} house`,
        valueCents: 45_000_000,
        valuedOn: new Date("2026-09-01"),
      },
    });
    await client.deadline.create({
      data: { userId, title: `${name} FSA deadline`, dueOn: new Date("2026-12-31"), kind: "fsa" },
    });
    return { userId, suffix };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("holds every kind of row for the person, and nothing of anyone else's", async () => {
    const me = await person("me");
    const other = await person("other");

    const data = await exportUserData(me.userId, { client });

    for (const key of [
      "banks",
      "accounts",
      "transactions",
      "recurringStreams",
      "liabilities",
      "findings",
      "decisions",
      "actions",
      "digests",
      "membershipIntents",
      "merchantCategories",
      "subscriptionChecks",
      "alerts",
      "askConversations",
      "budgets",
      "savingsGoals",
      "balanceSnapshots",
      "events",
      "ownedAssets",
      "deadlines",
      "lifeEvents",
      "janeMessages",
      "taxTags",
      "taxForms",
    ] as const) {
      expect(data[key], key).toHaveLength(1);
    }
    expect(data.profile.id).toBe(me.userId);
    expect(data.taxProfile).toMatchObject({ state: "CA", answered: ["state"] });
    const text = JSON.stringify(data);
    expect(text).toContain("me purchase");
    expect(text).not.toContain(other.suffix);
    // As a word: "otherDependants" is a field name.
    expect(text).not.toMatch(/\bother\b/);
  });

  it("includes their side of shared bills, not the partner's charges", async () => {
    const me = await person("payer");
    const partner = await person("partner");
    const { id: householdId } = await client.household.create({ select: { id: true } });
    await client.householdMember.createMany({
      data: [
        { householdId, userId: me.userId },
        { householdId, userId: partner.userId },
      ],
    });
    const charge = (payerId: string, transactionId: string) => ({
      householdId,
      transactionId,
      payerId,
      amountCents: 10_000,
      partnerShareBps: 5_000,
      userId: payerId,
    });
    await client.sharedCharge.createMany({
      data: [
        charge(me.userId, `mine-${me.suffix}`),
        charge(partner.userId, `theirs-${partner.suffix}`),
      ],
    });
    await client.settlement.create({
      data: {
        householdId,
        fromUserId: partner.userId,
        toUserId: me.userId,
        amountCents: 2_500,
        userId: partner.userId,
      },
    });

    const { household } = await exportUserData(me.userId, { client });

    expect(household?.household.sharedCharges.map((c) => c.transactionId)).toEqual([
      `mine-${me.suffix}`,
    ]);
    expect(household?.household.settlements).toMatchObject([{ amountCents: 2_500 }]);
  });

  it("never includes secrets or the team's private notes", async () => {
    const me = await person("secret");

    const text = JSON.stringify(await exportUserData(me.userId, { client }));

    for (const forbidden of [
      "access-sandbox",
      "accessTokenEncrypted",
      "cursor-",
      "transactionsCursor",
      "mfaSecret",
      "TOTPSECRET",
      "sess-",
      "sessionToken",
      "TEAM-ONLY NOTE",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("lists when the team saw their data, by role, never anyone else's (spec step 74)", async () => {
    const me = await person("seen");
    const other = await person("unseen");
    const adminId = `admin-${me.suffix}`;
    const view = async (userId: string) => {
      const { id } = await client.action.findFirstOrThrow({ where: { userId } });
      await client.auditLog.create({
        data: {
          actorType: "admin",
          actorId: adminId,
          event: "admin_viewed_action",
          targetType: "action",
          targetId: id,
          metadata: { user_id: userId },
        },
      });
    };
    await view(me.userId);
    await view(other.userId);

    const { teamAccess } = await exportUserData(me.userId, { client });

    expect(teamAccess).toMatchObject([
      { who: "Our concierge team", what: "Viewed your request", why: "x" },
    ]);
    expect(JSON.stringify(teamAccess)).not.toContain(adminId);
    await client.auditLog.deleteMany({ where: { actorId: adminId } });
  });

  it("lists the person's documents and their facts, but not the files (spec step 68)", async () => {
    const me = await person("docs");
    const other = await person("otherdocs");
    const document = (userId: string, fileName: string) => ({
      userId,
      kind: "insurance_policy",
      fileName,
      contentType: "application/pdf",
      sizeBytes: 9,
      encryptedBytes: Buffer.from("SECRETBYTES"),
      provider: "GEICO",
      premiumCents: 61_200,
      premiumFrequency: "semiannual",
      renewalDate: new Date("2027-03-01"),
      extractionSource: "claude",
    });
    await client.document.createMany({
      data: [document(me.userId, "my-policy.pdf"), document(other.userId, "their-policy.pdf")],
    });

    const data = await exportUserData(me.userId, { client });

    expect(data.documents.note).toContain("/documents");
    expect(data.documents.files).toMatchObject([
      { fileName: "my-policy.pdf", provider: "GEICO", premiumCents: 61_200 },
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toContain("their-policy.pdf");
    expect(text).not.toContain("encryptedBytes");
    expect(text).not.toContain(Buffer.from("SECRETBYTES").toString("base64"));
  });
});
