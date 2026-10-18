import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { plaidApiError } from "@/data-sources/plaid/__fixtures__/plaid";
import { logAudit } from "@/lib/audit";
import { deleteAllData } from "./account-deletion";
import { encrypt } from "./crypto";
import { removePlaidItem } from "./plaid/remove";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("deleting data against a real database", () => {
  let client: PrismaClient;
  const itemRemove = vi.fn();
  const api = { itemRemove } as unknown as PlaidApi;
  const partners: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: partners } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    itemRemove.mockReset().mockResolvedValue({ data: { request_id: "r" } });
    vi.mocked(logAudit).mockReset();
  });

  // A person with a row in every user-owned table.
  async function fullUser() {
    const suffix = crypto.randomUUID();
    const user = await client.user.create({ data: { email: `delete-${suffix}@example.com` } });
    const userId = user.id;
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${suffix}`,
        accessTokenEncrypted: encrypt(`access-${suffix}`),
      },
    });
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `acc-${suffix}`,
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const csv = await client.account.create({
      data: { userId, source: "csv", name: "Card", type: "credit", subtype: "credit card" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "plaid",
        plaidTransactionId: `t-${suffix}`,
        date: new Date(),
        amountCents: 100,
        description: "X",
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: csv.id,
        source: "csv",
        dedupeKey: "k",
        date: new Date(),
        amountCents: 100,
        description: "Y",
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
    const finding = await client.finding.create({
      data: { userId, type: "bank_fees", key: "k", title: "Fees", confidence: "high" },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: {} },
    });
    await client.action.create({
      data: { userId, decisionId: decision.id, type: "recover_bank_fees" },
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
    const partner = await client.referralPartner.upsert({
      where: { key: "deletion-test-partner" },
      create: {
        key: "deletion-test-partner",
        name: "Test Partner",
        actionType: "move_idle_cash",
        disclosure: "We may earn a fee.",
        referralUrl: "https://example.com",
      },
      update: {},
      select: { id: true },
    });
    await client.referralConversion.create({
      data: { partnerId: partner.id, userId, amountCents: 4_000 },
    });
    const snapshotAccount = await client.account.findFirstOrThrow({ where: { userId } });
    await client.balanceSnapshot.create({
      data: {
        userId,
        accountId: snapshotAccount.id,
        date: new Date("2026-10-01"),
        balanceCents: 100,
      },
    });
    await client.checkIn.create({
      data: { userId, month: "2026-09", summary: "s", source: "template" },
    });
    await client.savingsGoal.create({
      data: { userId, name: "Trip", targetCents: 200_000, targetDate: new Date("2027-06-01") },
    });
    await client.budget.create({
      data: { userId, category: "Food and drink", amountCents: 40_000 },
    });
    await client.pushSubscription.create({
      data: { userId, endpoint: `https://push.example/${suffix}`, p256dh: "p", auth: "a" },
    });
    const household = await client.household.create({ select: { id: true } });
    await client.householdMember.create({ data: { householdId: household.id, userId } });
    await client.householdInvite.create({
      data: {
        householdId: household.id,
        userId,
        email: `partner-${suffix}@example.com`,
        tokenHash: `hash-${suffix}`,
        expiresAt: new Date(Date.now() + 1e9),
      },
    });
    // A partner who stays in the household, and a shared bill between them.
    const spouse = await client.user.create({ data: { email: `partner-${suffix}@example.org` } });
    partners.push(spouse.id);
    await client.householdMember.create({
      data: { householdId: household.id, userId: spouse.id },
    });
    await client.sharedCharge.create({
      data: {
        householdId: household.id,
        transactionId: `tx-${suffix}`,
        payerId: userId,
        amountCents: 10_000,
        partnerShareBps: 5_000,
        userId,
      },
    });
    await client.settlement.create({
      data: {
        householdId: household.id,
        fromUserId: spouse.id,
        toUserId: userId,
        amountCents: 5_000,
        userId,
      },
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
    await client.authAccount.create({
      data: { userId, type: "oauth", provider: "google", providerAccountId: `g-${suffix}` },
    });
    await client.mfaBackupCode.create({ data: { userId, codeHash: `hash-${suffix}` } });
    await client.standingRule.create({
      data: { userId, key: "recover_bank_fees", monthlyLimit: 3 },
    });
    await client.planProposal.create({
      data: { userId, key: "goal:emergency_fund", kind: "goal", payload: {} },
    });
    await client.planLink.create({
      data: { userId, tokenHash: `hash-link-${suffix}`, items: [], expiresAt: new Date() },
    });
    const agentAction = await client.action.findFirstOrThrow({ where: { userId } });
    await client.agentMessage.create({
      data: {
        userId,
        actionId: agentAction.id,
        direction: "outbound",
        toAddress: "support@company.example",
        fromAddress: "agent@jane.test",
        subject: "Refund",
        body: "Please refund.",
      },
    });
    return { userId, itemId: item.id, accessToken: `access-${suffix}` };
  }

  async function rowsFor(userId: string) {
    const where = { where: { userId } };
    return {
      users: await client.user.count({ where: { id: userId } }),
      plaidItems: await client.plaidItem.count(where),
      accounts: await client.account.count(where),
      transactions: await client.transaction.count(where),
      recurringStreams: await client.recurringStream.count(where),
      findings: await client.finding.count(where),
      decisions: await client.decision.count(where),
      actions: await client.action.count(where),
      digests: await client.digest.count(where),
      membershipIntents: await client.membershipIntent.count(where),
      analyticsEvents: await client.analyticsEvent.count(where),
      merchantCategories: await client.merchantCategory.count(where),
      subscriptionChecks: await client.subscriptionCheck.count(where),
      alerts: await client.alert.count(where),
      askConversations: await client.askConversation.count(where),
      askMessages: await client.askMessage.count(where),
      householdMembers: await client.householdMember.count(where),
      householdInvites: await client.householdInvite.count(where),
      pushSubscriptions: await client.pushSubscription.count(where),
      referralConversions: await client.referralConversion.count(where),
      budgets: await client.budget.count(where),
      savingsGoals: await client.savingsGoal.count(where),
      balanceSnapshots: await client.balanceSnapshot.count(where),
      checkIns: await client.checkIn.count(where),
      sharedCharges: await client.sharedCharge.count(where),
      settlements: await client.settlement.count(where),
      sessions: await client.session.count(where),
      authAccounts: await client.authAccount.count(where),
      mfaBackupCodes: await client.mfaBackupCode.count(where),
      standingRules: await client.standingRule.count(where),
      agentMessages: await client.agentMessage.count(where),
      planProposals: await client.planProposal.count(where),
      planLinks: await client.planLink.count(where),
    };
  }

  it("removes every Plaid item at Plaid, then leaves no rows for the user", async () => {
    const { userId, accessToken } = await fullUser();
    expect(Object.values(await rowsFor(userId)).every((n) => n > 0)).toBe(true);

    await deleteAllData(userId, { client, api });

    expect(itemRemove).toHaveBeenCalledWith({ access_token: accessToken });
    expect(Object.values(await rowsFor(userId)).every((n) => n === 0)).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "user_data_deleted",
      { type: "user", id: userId },
      { plaid_items_removed: 1 },
    );
  });

  it("deletes nothing if Plaid can't remove an item, so the person can retry", async () => {
    const { userId } = await fullUser();
    itemRemove.mockRejectedValue(plaidApiError("INTERNAL_SERVER_ERROR", 500));

    await expect(deleteAllData(userId, { client, api })).rejects.toThrow();

    expect((await rowsFor(userId)).users).toBe(1);
    expect((await rowsFor(userId)).plaidItems).toBe(1);
    await client.user.delete({ where: { id: userId } });
  });

  it("treats an item Plaid no longer knows as removed", async () => {
    const { userId, itemId } = await fullUser();
    itemRemove.mockRejectedValue(plaidApiError("ITEM_NOT_FOUND"));

    await removePlaidItem(userId, itemId, "user_disconnected", { client, api });

    const rows = await rowsFor(userId);
    expect(rows).toMatchObject({ plaidItems: 0, recurringStreams: 0, users: 1 });
    // The CSV account and its transaction stay; only the bank's data goes.
    expect(rows.accounts).toBe(1);
    expect(rows.transactions).toBe(1);
    await client.user.delete({ where: { id: userId } });
  });
});
