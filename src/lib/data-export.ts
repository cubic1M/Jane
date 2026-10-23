import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { investmentsExport } from "@/lib/investments/holdings";
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
    changeAcks,
    lifeEventAnswers,
    budgetTuneUps,
    goalTransfers,
    savedShares,
    autopilotSectors,
    autopilotActs,
    controllerRuns,
    moneyTransfers,
    paycheckPlans,
    healthScores,
    unusualAnswers,
    yearPlans,
    booksIssues,
    monthCloses,
    suggestions,
    leanPlans,
    whatIfPlans,
    monthlyReports,
    janeMessages,
    janePreferences,
    teamAccess,
    taxProfile,
    taxTags,
    taxForms,
    taxReturns,
    taxDocuments,
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
    // Changes the person said were expected (spec step 97).
    db.changeAcks.findMany({ select: { key: true, kind: true, createdAt: true } }),
    // Answers to the life events Jane spotted (spec step 100).
    db.lifeEventAnswers.findMany({ select: { kind: true, answer: true, createdAt: true } }),
    // Budget tune-ups and transfers counted toward goals (spec step 101).
    db.budgetTuneUps.findMany({
      select: { month: true, changes: true, status: true, decidedAt: true, createdAt: true },
    }),
    db.goalTransfers.findMany({
      select: {
        transactionId: true,
        goalId: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
    }),
    // Shared savings totals (spec step 139): never the token itself.
    db.savedShares.findMany({ select: { totalCents: true, createdAt: true, revokedAt: true } }),
    // One autopilot, every sector (spec step 141): what was set, and what Jane did by herself.
    db.autopilotSectors.findMany({
      select: {
        sector: true,
        level: true,
        actionCapCents: true,
        monthlyCapCents: true,
        updatedAt: true,
      },
    }),
    db.autopilotActs.findMany({
      select: { sector: true, cents: true, what: true, createdAt: true },
    }),
    // The nightly controller run's log (spec step 142).
    db.controllerRuns.findMany({
      select: { day: true, startedAt: true, finishedAt: true, steps: true },
    }),
    // Money that moved by itself, or on a tap (spec steps 144–145).
    db.moneyTransfers.findMany({
      select: {
        toName: true,
        amountCents: true,
        purpose: true,
        status: true,
        runOn: true,
        by: true,
        partner: true,
        createdAt: true,
      },
    }),
    db.paycheckPlans.findMany({
      select: { paycheckCents: true, paidOn: true, moves: true, status: true, createdAt: true },
    }),
    db.healthScores.findMany({
      orderBy: { month: "asc" },
      select: { month: true, score: true, band: true, parts: true },
    }),
    db.unusualAnswers.findMany({
      orderBy: { createdAt: "asc" },
      select: { merchantKey: true, rule: true, answer: true, amountCents: true, createdAt: true },
    }),
    db.yearPlans.findMany({
      orderBy: { startMonth: "asc" },
      select: { startMonth: true, months: true, updatedAt: true },
    }),
    db.booksIssues.findMany({
      orderBy: { createdAt: "asc" },
      select: { kind: true, key: true, detail: true, status: true, createdAt: true, fixedAt: true },
    }),
    db.monthCloses.findMany({
      orderBy: { month: "asc" },
      select: { month: true, status: true, figures: true, closedAt: true, correctedAt: true },
    }),
    db.suggestions.findMany({
      orderBy: { firstSeenAt: "asc" },
      select: {
        key: true,
        title: true,
        worthCents: true,
        confidencePercent: true,
        confidenceReason: true,
        why: true,
        status: true,
        firstSeenAt: true,
        answeredAt: true,
      },
    }),
    db.leanPlans.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        employer: true,
        dueOn: true,
        status: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
      },
    }),
    db.whatIfPlans.findMany({
      orderBy: { createdAt: "asc" },
      select: { scenario: true, params: true, changes: true, status: true, createdAt: true },
    }),
    db.monthlyReports.findMany({
      orderBy: { month: "asc" },
      select: { month: true, figures: true, emailedAt: true, createdAt: true },
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
    // What Jane remembers (spec step 91).
    db.janePreferences.findMany({
      select: { kind: true, key: true, value: true, label: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // When the team or Jane's agent viewed or acted on their data (spec step 74): every
    // entry, by role, never a team member's name or id.
    teamAccessFor(userId, { client, limit: null }),
    // Their tax profile (spec step 118): their answers.
    db.taxProfiles.findFirst({
      select: {
        filingStatus: true,
        childrenUnder17: true,
        otherDependants: true,
        state: true,
        incomeKinds: true,
        answered: true,
        // Spec step 120: their pay stub figures.
        payAsOf: true,
        payGrossYtdCents: true,
        payFederalYtdCents: true,
        payStateYtdCents: true,
        payRetirementYtdCents: true,
        payPretaxYtdCents: true,
        // Spec step 123: the freelance helpers.
        homeOfficeSqFt: true,
        businessMiles: true,
        businessMilesYear: true,
        taxPayments: true,
        refundsHandled: true,
        // Spec step 165: where they lived and worked.
        moves: true,
        workState: true,
        locality: true,
        residencyYear: true,
        updatedAt: true,
      },
    }),
    // Tax tags they chose and tax forms they said arrived (spec step 119).
    db.taxTags.findMany({
      select: { transactionId: true, merchantKey: true, tag: true, updatedAt: true },
    }),
    db.taxForms.findMany({ select: { year: true, key: true, receivedAt: true } }),
    // Returns filed through the filing partner (spec step 126), with what was handed over.
    db.taxReturns.findMany({
      select: {
        year: true,
        partner: true,
        status: true,
        package: true,
        preview: true,
        signerName: true,
        signedAt: true,
        submittedAt: true,
        acceptedAt: true,
      },
    }),
    // Tax forms Jane collected (spec step 166), with their boxes.
    db.taxDocuments.findMany({
      select: {
        year: true,
        formKey: true,
        payer: true,
        partner: true,
        boxes: true,
        fetchedAt: true,
        decision: true,
      },
    }),
  ]);
  // Terms they typed for debts their bank doesn't report (spec step 109).
  const debtTerms = await db.debtTerms.findMany({
    select: {
      debtKey: true,
      aprBps: true,
      minimumPaymentCents: true,
      balanceCents: true,
      payoffDate: true,
      updatedAt: true,
    },
    orderBy: { debtKey: "asc" },
  });
  // Their payoff plan, the refinance offers Jane checked, and their loan applications
  // (spec steps 110–112).
  const [debtPlan, refinanceCheck, loanApplications, balanceTransfers, studentLoanProfile] =
    await Promise.all([
      db.debtPlans.findFirst({
        select: {
          strategy: true,
          extraCents: true,
          startedOn: true,
          checkedOn: true,
          status: true,
        },
      }),
      db.refinanceChecks.findFirst({ select: { checkedOn: true, partner: true, quotes: true } }),
      db.loanApplications.findMany({
        select: {
          lender: true,
          oldName: true,
          product: true,
          aprBps: true,
          termMonths: true,
          amountCents: true,
          monthlyCents: true,
          feeCents: true,
          status: true,
          applicant: true,
          submittedAt: true,
          acceptedAt: true,
          fundedAt: true,
          paidOffAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      // Spec steps 113–114.
      db.balanceTransfers.findMany({
        select: {
          fromName: true,
          cardName: true,
          amountCents: true,
          feeCents: true,
          promoMonths: true,
          startedOn: true,
          promoEndsOn: true,
          status: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      db.studentLoanProfiles.findFirst({
        select: {
          agiCents: true,
          familySize: true,
          dependants: true,
          borrower: true,
          publicService: true,
          countedBefore: true,
          stepsDone: true,
        },
      }),
    ]);
  // What's in their investment accounts and its history (spec step 128).
  const investments = await investmentsExport(userId, client);
  // Insurance (spec Phase X): every policy on the profile and the household facts.
  const insurance = await insuranceExport(userId, { client });

  return {
    exportedAt: now.toISOString(),
    formatVersion: EXPORT_FORMAT_VERSION,
    profile,
    insurance,
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
    debtTerms,
    debtPlan,
    refinanceCheck,
    loanApplications,
    balanceTransfers,
    studentLoanProfile,
    documents: {
      note: "The files themselves aren't in this download. Download each one from /documents.",
      files: documents,
    },
    deadlines,
    lifeEvents,
    changeAcks,
    lifeEventAnswers,
    budgetTuneUps,
    goalTransfers,
    savedShares,
    autopilotSectors,
    autopilotActs,
    controllerRuns,
    moneyTransfers,
    paycheckPlans,
    healthScores,
    monthlyReports,
    whatIfPlans,
    suggestions,
    leanPlans,
    booksIssues,
    monthCloses,
    yearPlans,
    unusualAnswers,
    janeMessages,
    janePreferences,
    investments,
    teamAccess: teamAccess.map(({ at, who, what, why, actionId }) => ({
      at,
      who,
      what,
      why,
      actionId,
    })),
    taxProfile,
    taxTags,
    taxForms,
    taxReturns,
    taxDocuments,
  };
}
