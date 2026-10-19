import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { teamAccessFor } from "@/lib/team-access-loader";
import { insuranceExport } from "@/lib/insurance/export";

// "Download my data": everything the app holds about one person, as JSON. Never another
// person's rows, never secrets (Plaid access tokens and sync cursors, the two-factor
// secret, session tokens), and not the team's private notes about actions.

export const EXPORT_FORMAT_VERSION = 1;

export async function exportUserData(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const db = scopedFor(userId, client);
  const [
    profile,
    banks,
    accounts,
    transactions,
    recurringStreams,
    liabilities,
    findings,
    decisions,
    actions,
    digests,
    membershipIntents,
    merchantCategories,
    subscriptionChecks,
    alerts,
    askConversations,
    household,
    pushDevices,
    backupCodesLeft,
    standingRules,
    agentMessages,
    planProposals,
    planLinks,
    budgets,
    savingsGoals,
    balanceSnapshots,
    checkIns,
    events,
    ownedAssets,
    documents,
    deadlines,
    lifeEvents,
    janeMessages,
    teamAccess,
  ] = await Promise.all([
    client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        timezone: true,
        digestEnabled: true,
        alertPrefs: true,
        state: true,
        // When the calendar link was made, not the link itself (it works as a key).
        calendarCreatedAt: true,
        termsVersion: true,
        termsAcceptedAt: true,
        checklistProgress: true,
        checklistDismissedAt: true,
        mfaEnabledAt: true,
      },
    }),
    db.plaidItems.findMany({
      select: {
        id: true,
        institutionName: true,
        status: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    }),
    db.accounts.findMany({
      select: {
        id: true,
        source: true,
        name: true,
        mask: true,
        type: true,
        subtype: true,
        currentBalanceCents: true,
        availableBalanceCents: true,
        sharedWithHousehold: true,
        createdAt: true,
      },
    }),
    db.transactions.findMany({
      select: {
        id: true,
        accountId: true,
        source: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcPrimary: true,
        pfcDetailed: true,
        pending: true,
      },
      orderBy: { date: "asc" },
    }),
    db.recurringStreams.findMany({
      select: {
        id: true,
        accountId: true,
        merchantName: true,
        frequency: true,
        lastAmountCents: true,
        averageAmountCents: true,
        lastDate: true,
        status: true,
        isActive: true,
      },
    }),
    // What the bank reports about each card and loan (spec step 65).
    db.liabilities.findMany({
      select: {
        accountId: true,
        kind: true,
        aprBps: true,
        rateType: true,
        minimumPaymentCents: true,
        nextPaymentDueDate: true,
        lastPaymentCents: true,
        lastPaymentDate: true,
        originationPrincipalCents: true,
        originationDate: true,
        payoffDate: true,
        isOverdue: true,
        pastDueCents: true,
        ytdInterestPaidCents: true,
        description: true,
        updatedAt: true,
      },
    }),
    db.findings.findMany({
      select: {
        id: true,
        type: true,
        title: true,
        explanation: true,
        annualSavingsCents: true,
        confidence: true,
        evidence: true,
        status: true,
        createdAt: true,
      },
    }),
    db.decisions.findMany({
      select: {
        id: true,
        findingId: true,
        choice: true,
        source: true,
        options: true,
        ruleKey: true,
        cardSnapshot: true,
        createdAt: true,
        undoneAt: true,
      },
    }),
    db.actions.findMany({
      select: {
        id: true,
        decisionId: true,
        type: true,
        status: true,
        userTodo: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    }),
    db.digests.findMany({
      select: { weekStart: true, payload: true, sentAt: true, openedAt: true },
    }),
    db.membershipIntents.findMany({ select: { kind: true, amountCents: true, createdAt: true } }),
    db.merchantCategories.findMany({
      select: { merchantKey: true, pfcPrimary: true, pfcDetailed: true, source: true },
    }),
    db.subscriptionChecks.findMany({
      select: { merchantKey: true, isSubscription: true, createdAt: true },
    }),
    db.alerts.findMany({
      select: {
        type: true,
        title: true,
        body: true,
        createdAt: true,
        readAt: true,
        emailedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.askConversations.findMany({
      select: {
        title: true,
        createdAt: true,
        messages: {
          select: { role: true, content: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Their own membership, the invites they sent and their side of shared bills; never the
    // partner's data.
    client.householdMember.findUnique({
      where: { userId },
      select: {
        joinedAt: true,
        household: {
          select: {
            invites: {
              where: { userId },
              select: { email: true, createdAt: true, acceptedAt: true },
            },
            // Charges they paid and split, and settle-ups they were part of.
            sharedCharges: {
              where: { payerId: userId },
              select: {
                transactionId: true,
                amountCents: true,
                partnerShareBps: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            settlements: {
              where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
              select: { fromUserId: true, toUserId: true, amountCents: true, createdAt: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    }),
    // How many devices get notifications, not their push addresses (those work as keys).
    db.pushSubscriptions.count(),
    // How many two-factor backup codes are unused; never the codes or their hashes.
    db.mfaBackupCodes.count({ where: { usedAt: null } }),
    db.standingRules.findMany({
      select: {
        key: true,
        enabled: true,
        monthlyLimit: true,
        maxAnnualCents: true,
        updatedAt: true,
      },
    }),
    // Every email the action agent sent or received for the person's actions.
    db.agentMessages.findMany({
      select: {
        actionId: true,
        direction: true,
        toAddress: true,
        fromAddress: true,
        subject: true,
        body: true,
        summary: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.planProposals.findMany({
      select: {
        key: true,
        kind: true,
        payload: true,
        status: true,
        createdAt: true,
        answeredAt: true,
      },
    }),
    // When one-tap links were made and used; never their tokens.
    db.planLinks.findMany({
      select: { items: true, decisionIds: true, expiresAt: true, usedAt: true, createdAt: true },
    }),
    db.budgets.findMany({ select: { category: true, amountCents: true, createdAt: true } }),
    db.savingsGoals.findMany({
      select: {
        name: true,
        targetCents: true,
        targetDate: true,
        manualSavedCents: true,
        createdAt: true,
      },
    }),
    db.balanceSnapshots.findMany({
      select: { accountId: true, date: true, balanceCents: true },
      orderBy: [{ date: "asc" }, { accountId: "asc" }],
    }),
    db.checkIns.findMany({ select: { month: true, summary: true, emailedAt: true } }),
    client.analyticsEvent.findMany({
      where: { userId },
      select: { name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // Things they own, at their values (spec step 67).
    db.ownedAssets.findMany({
      select: {
        kind: true,
        name: true,
        valueCents: true,
        valuedOn: true,
        loanAccountId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    // Uploaded policies, warranties and receipts (spec step 68): what each is and its key
    // facts, not the files, which download one by one from /documents.
    db.documents.findMany({
      select: {
        id: true,
        kind: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        provider: true,
        policyType: true,
        coverageSummary: true,
        premiumCents: true,
        premiumFrequency: true,
        renewalDate: true,
        warrantyEndsOn: true,
        purchaseDate: true,
        purchaseAmountCents: true,
        extractionSource: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: "asc" },
    }),
    // Deadlines they typed in (spec step 71).
    db.deadlines.findMany({
      select: { title: true, dueOn: true, kind: true, note: true, doneAt: true, createdAt: true },
      orderBy: { dueOn: "asc" },
    }),
    // Life-event checklists (spec step 72).
    db.lifeEvents.findMany({
      select: {
        kind: true,
        startedOn: true,
        checkedItems: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    // Jane's chat (spec step 81): every message, with the buttons and what they answered.
    db.janeMessages.findMany({
      select: {
        kind: true,
        body: true,
        refs: true,
        actions: true,
        status: true,
        answeredWith: true,
        answeredAt: true,
        readAt: true,
        createdAt: true,
        snoozedUntil: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    // When the team or Jane's agent viewed or acted on their data (spec step 74): every
    // entry, by role, never a team member's name or id.
    teamAccessFor(userId, { client, limit: null }),
  ]);
  // Insurance (spec Phase X): every policy on the profile and the household facts.
  const insurance = await insuranceExport(userId, { client });

  return {
    exportedAt: now.toISOString(),
    formatVersion: EXPORT_FORMAT_VERSION,
    profile,
    banks,
    accounts,
    transactions,
    recurringStreams,
    liabilities,
    findings,
    decisions,
    actions,
    digests,
    membershipIntents,
    merchantCategories,
    subscriptionChecks,
    alerts,
    askConversations,
    household,
    pushDevices,
    backupCodesLeft,
    standingRules,
    agentMessages,
    planProposals,
    planLinks,
    budgets,
    savingsGoals,
    balanceSnapshots,
    checkIns,
    events,
    ownedAssets,
    documents: {
      note: "The files themselves aren't in this download. Download each one from /documents.",
      files: documents,
    },
    deadlines,
    lifeEvents,
    janeMessages,
    insurance,
    teamAccess: teamAccess.map(({ at, who, what, why, actionId }) => ({
      at,
      who,
      what,
      why,
      actionId,
    })),
  };
}
