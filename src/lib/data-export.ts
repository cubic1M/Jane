import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

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
    budgets,
    events,
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
        termsVersion: true,
        termsAcceptedAt: true,
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
    // Their own membership and the invites they sent; never the partner's data.
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
          },
        },
      },
    }),
    // How many devices get notifications, not their push addresses (those work as keys).
    db.pushSubscriptions.count(),
    db.budgets.findMany({ select: { category: true, amountCents: true, createdAt: true } }),
    client.analyticsEvent.findMany({
      where: { userId },
      select: { name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    exportedAt: now.toISOString(),
    formatVersion: EXPORT_FORMAT_VERSION,
    profile,
    banks,
    accounts,
    transactions,
    recurringStreams,
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
    budgets,
    events,
  };
}
