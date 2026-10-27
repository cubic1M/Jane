import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { evidenceRefs, onSharedAccountsOnly } from "@/lib/finding-accounts";
import { inReadCache } from "@/lib/read-cache";
import { forgetReads, memoKey, memoRead, READ_OPERATIONS } from "@/lib/read-memo";
import { asUser, asUserTransaction, SCOPED_QUERY_TRANSACTION, withRls } from "@/lib/rls";
import { requireUser } from "@/lib/session";

// Every query on a user-owned table goes through here. scopeArgs ANDs the user's id onto
// every filter, so a caller's own filter can only narrow it: asking for another user's
// rows matches nothing. Writes always get the user's id. Ids passed in relations
// (e.g. accountId) must come from scoped reads.

type Args = Record<string, unknown>;

const FILTER_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
]);

const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);

function withUser(value: unknown, userId: string): Args {
  return { ...(value as Args | undefined), userId };
}

function whereUser(where: unknown, userId: string): Args {
  const scoped: Args = { ...(where as Args | undefined) };
  const and = scoped.AND === undefined ? [] : Array.isArray(scoped.AND) ? scoped.AND : [scoped.AND];
  scoped.AND = [...and, { userId }];
  return scoped;
}

export function scopeArgs(operation: string, args: Args | undefined, userId: string): Args {
  const scoped: Args = { ...args };

  if (FILTER_OPERATIONS.has(operation)) {
    scoped.where = whereUser(scoped.where, userId);
  } else if (UPDATE_OPERATIONS.has(operation)) {
    scoped.where = whereUser(scoped.where, userId);
    // Setting userId again stops an update from moving a row to another user.
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "create") {
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(scoped.data) ? scoped.data : [scoped.data];
    scoped.data = rows.map((row) => withUser(row, userId));
  } else if (operation === "upsert") {
    scoped.where = whereUser(scoped.where, userId);
    scoped.create = withUser(scoped.create, userId);
    scoped.update = withUser(scoped.update, userId);
  } else {
    // Fail closed: a new Prisma operation must be reviewed before it is allowed here.
    throw new Error(`"${operation}" is not supported on user-scoped queries`);
  }

  return scoped;
}

// Each query: the user's id ANDed on (scopeArgs), shared reads within a render, and `run`, which
// sends it to the database.
function scopedQueries(
  client: PrismaClient,
  userId: string,
  run: (query: () => Prisma.PrismaPromise<unknown>, operation: string) => Promise<unknown>,
) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scopedArgs = scopeArgs(operation, args as Args, userId) as typeof args;
          const send = () =>
            run(() => query(scopedArgs) as Prisma.PrismaPromise<unknown>, operation);
          // A write changes what the page's reads would see: forget the render's shared answers
          // before and after it. A read asking exactly what an earlier one asked shares its answer.
          if (!READ_OPERATIONS.has(operation)) {
            forgetReads();
            try {
              return await send();
            } finally {
              forgetReads();
            }
          }
          // Inside a read cache (src/lib/read-cache.ts) every read must reach it, which notes the
          // tables each cached value came from; it shares repeated reads itself.
          if (inReadCache()) return send();
          return memoRead(memoKey(userId, model, operation, scopedArgs), send);
        },
      },
    },
  });
}

export function scopedFor(userId: string, client: PrismaClient = db) {
  if (!userId) throw new Error("scopedFor needs a user id");
  // Every query is also its own short transaction as the user, so the database's row-level
  // security (src/lib/rls.ts) checks it too: a query that scopeArgs somehow let through still
  // can't see or change another person's rows.
  const scoped = scopedQueries(client, userId, (query, operation) =>
    withRls((rls) =>
      rls
        ? client
            .$transaction(
              [
                asUser(client, userId, READ_OPERATIONS.has(operation) ? "reads" : "writes"),
                query(),
              ],
              SCOPED_QUERY_TRANSACTION,
            )
            .then(([, result]) => result)
        : query(),
    ),
  );
  // Inside an interactive transaction the transaction itself is switched to the user once.
  const inTransaction = scopedQueries(client, userId, (query) => query());

  // Only user-owned tables are exposed; users, audit_log and analytics have their own helpers.
  return {
    // An interactive transaction over the same scoped tables.
    transaction: <T>(
      run: (tx: {
        findings: typeof inTransaction.finding;
        decisions: typeof inTransaction.decision;
        actions: typeof inTransaction.action;
      }) => Promise<T>,
    ) =>
      asUserTransaction(inTransaction, userId, (tx) =>
        run({ findings: tx.finding, decisions: tx.decision, actions: tx.action }),
      )
        // Reads made inside it may have seen rows that were rolled back.
        .finally(() => forgetReads()),
    userId,
    plaidItems: scoped.plaidItem,
    accounts: scoped.account,
    transactions: scoped.transaction,
    recurringStreams: scoped.recurringStream,
    liabilities: scoped.liability,
    ownedAssets: scoped.ownedAsset,
    debtTerms: scoped.debtTerms,
    debtPlans: scoped.debtPlan,
    // Insurance (spec Phase X).
    insurancePolicies: scoped.insurancePolicy,
    insuranceProfiles: scoped.insuranceProfile,
    insuranceQuotes: scoped.insuranceQuote,
    insuranceShops: scoped.insuranceShop,
    insuranceCheckups: scoped.insuranceCheckup,
    insuranceClaims: scoped.insuranceClaim,
    employerBenefits: scoped.employerBenefit,
    policyReadings: scoped.policyReading,
    lifeApplications: scoped.lifeApplication,
    coverChanges: scoped.coverChange,
    renewalNegotiations: scoped.renewalNegotiation,
    insuranceSavings: scoped.insuranceSaving,
    insuranceRisks: scoped.insuranceRisk,
    refinanceChecks: scoped.refinanceCheck,
    loanApplications: scoped.loanApplication,
    studentLoanProfiles: scoped.studentLoanProfile,
    creditReports: scoped.creditReport,
    debtWatches: scoped.debtWatch,
    cardApplications: scoped.cardApplication,
    tightRequests: scoped.tightRequest,
    medicalBills: scoped.medicalBill,
    medicalRequests: scoped.medicalRequest,
    creditDisputes: scoped.creditDispute,
    cardPromos: scoped.cardPromo,
    cardRateRequests: scoped.cardRateRequest,
    personalLoans: scoped.personalLoan,
    creditGoals: scoped.creditGoal,
    homeEquityFacts: scoped.homeEquityFacts,
    carAddons: scoped.carAddon,
    carLoanWatches: scoped.carLoanWatch,
    rentReporting: scoped.rentReporting,
    securityDeposits: scoped.securityDeposit,
    familyCredit: scoped.familyCreditHelp,
    borrowingChecks: scoped.borrowingCheck,
    balanceTransfers: scoped.balanceTransfer,
    findings: scoped.finding,
    decisions: scoped.decision,
    actions: scoped.action,
    digests: scoped.digest,
    membershipIntents: scoped.membershipIntent,
    merchantCategories: scoped.merchantCategory,
    subscriptionChecks: scoped.subscriptionCheck,
    alerts: scoped.alert,
    askConversations: scoped.askConversation,
    askMessages: scoped.askMessage,
    pushSubscriptions: scoped.pushSubscription,
    budgets: scoped.budget,
    savingsGoals: scoped.savingsGoal,
    balanceSnapshots: scoped.balanceSnapshot,
    // Uploads finishing in the background (src/lib/import/background.ts).
    importRuns: scoped.importRun,
    checkIns: scoped.checkIn,
    mfaBackupCodes: scoped.mfaBackupCode,
    standingRules: scoped.standingRule,
    agentMessages: scoped.agentMessage,
    planProposals: scoped.planProposal,
    planLinks: scoped.planLink,
    // Jane's chat (spec step 81).
    janeMessages: scoped.janeMessage,
    // Spec step 91.
    janePreferences: scoped.janePreference,
    documents: scoped.document,
    deadlines: scoped.deadline,
    lifeEvents: scoped.lifeEvent,
    // Taxes (spec steps 118–127).
    taxProfiles: scoped.taxProfile,
    taxTags: scoped.taxTag,
    taxForms: scoped.taxForm,
    taxDocuments: scoped.taxDocument,
    priorReturns: scoped.priorReturn,
    taxAmendments: scoped.taxAmendment,
    taxNotices: scoped.taxNotice,
    taxIdentityCases: scoped.taxIdentityCase,
    equityEvents: scoped.equityEvent,
    taxPlanEvents: scoped.taxPlanEvent,
    propertyAppeals: scoped.propertyAppeal,
    taxPayments: scoped.taxPayment,
    accountantLinks: scoped.accountantLink,
    accountantNotes: scoped.accountantNote,
    taxReturns: scoped.taxReturn,
    // Spec step 270: disaster losses kept with their insurance claims.
    disasterLosses: scoped.disasterLoss,
    // Spec step 272: draft returns checked before filing.
    draftReturns: scoped.draftReturn,
    // One-tap answers from Jane's emails (spec step 85).
    chatReplyLinks: scoped.chatReplyLink,
    // "That's expected" on a change (spec step 97).
    changeAcks: scoped.changeAck,
    // Answers to "Are you moving?" and the like (spec step 100).
    lifeEventAnswers: scoped.lifeEventAnswer,
    // Plans that keep up (spec step 101).
    budgetTuneUps: scoped.budgetTuneUp,
    goalTransfers: scoped.goalTransfer,
    // Shared "What Jane saved me" totals (spec step 139).
    // One autopilot, every sector (spec step 141).
    autopilotSectors: scoped.autopilotSector,
    autopilotActs: scoped.autopilotAct,
    // The nightly controller run's log (spec step 142).
    controllerRuns: scoped.controllerRun,
    // Money that moves itself (spec steps 144–145).
    moneyTransfers: scoped.moneyTransfer,
    paycheckPlans: scoped.paycheckPlan,
    // Money health score by month (spec step 146).
    healthScores: scoped.healthScore,
    // The monthly money report (spec step 148).
    monthlyReports: scoped.monthlyReport,
    // The monthly close (spec step 244).
    monthCloses: scoped.monthClose,
    // Adopted what-if plans (spec step 203).
    whatIfPlans: scoped.whatIfPlan,
    // The lean plan when income stops (spec step 204).
    leanPlans: scoped.leanPlan,
    // Data that doesn't add up (spec step 238).
    booksIssues: scoped.booksIssue,
    // What Jane suggests (spec step 255).
    suggestions: scoped.suggestion,
    suggestionOutcomes: scoped.suggestionOutcome,
    // The year's money plan (spec step 205).
    yearPlans: scoped.yearPlan,
    // "This was me" / "not me" on unusual activity (spec step 208).
    unusualAnswers: scoped.unusualAnswer,
    savedShares: scoped.savedShare,
    // What's in investment accounts (spec step 128).
    securities: scoped.security,
    holdings: scoped.holding,
    investmentTransactions: scoped.investmentTransaction,
    // What the investments are for (spec step 129).
    investorProfiles: scoped.investorProfile,
    // Orders through the brokerage partner (spec step 133).
    brokerageOrders: scoped.brokerageOrder,
    // Automatic investing (spec step 134).
    autoInvestPlans: scoped.autoInvestPlan,
    autoInvestRuns: scoped.autoInvestRun,
    // College savings (spec step 158).
    collegePlans: scoped.collegePlan,
    // The HSA receipts vault (spec step 159).
    hsaReceipts: scoped.hsaReceipt,
    // Company stock grants (spec step 160).
    equityGrants: scoped.equityGrant,
    // Crypto, read-only (spec step 161).
    payrollChanges: scoped.payrollChange,
    oldPlans: scoped.oldPlan,
    retirementIncomes: scoped.retirementIncome,
    familyChildren: scoped.familyChild,
    rentalProperties: scoped.rentalProperty,
    costlyProducts: scoped.costlyProduct,
    planMenus: scoped.planMenu,
    billLadders: scoped.billLadder,
    suddenMoneys: scoped.suddenMoney,
    valuesPreferences: scoped.valuesPreference,
    accountBeneficiaries: scoped.accountBeneficiary,
    familyFiles: scoped.familyFile,
    planChanges: scoped.planChange,
    practicePortfolios: scoped.practicePortfolio,
    practicePositions: scoped.practicePosition,
    practiceTrades: scoped.practiceTrade,
    // What the daily scan flagged in a practice portfolio (spec step 292).
    practiceOpportunities: scoped.practiceOpportunity,
    // What the person wants from the practice portfolio (Phase AW).
    practicePreferences: scoped.practicePreferences,
    // The paper account, run by the person's chosen strategy (src/lib/paper/).
    paperAccounts: scoped.paperAccount,
    paperPositions: scoped.paperPosition,
    paperTrades: scoped.paperTrade,
    paperValues: scoped.paperValue,
    paperSignals: scoped.paperSignal,
    // The events overlay on it (src/lib/events/run.ts) and its log.
    paperEventOverlays: scoped.paperEventOverlay,
    paperEventLogs: scoped.paperEventLog,
    giftLinks: scoped.giftLink,
    cryptoConnections: scoped.cryptoConnection,
    cryptoHoldings: scoped.cryptoHolding,
  };
}

export type ScopedDb = ReturnType<typeof scopedFor>;

// The usual entry point in pages, server actions and route handlers.
export async function scopedDb(): Promise<ScopedDb> {
  const user = await requireUser();
  return scopedFor(user.id);
}

// What a household partner may read of the other person's data: accounts they chose to
// share, those accounts' transactions, and undecided findings that sit entirely on them.
// Read-only by construction: there are no write methods to call. Membership is checked
// every time this is built, so leaving a household removes access at once. Decisions are
// never exposed, and only undecided findings are, so a decision can't be read off a status.
export async function sharedReadFor(viewerId: string, client: PrismaClient = db) {
  const membership = await client.householdMember.findUnique({
    where: { userId: viewerId },
    select: { householdId: true },
  });
  const partners = membership
    ? await client.householdMember.findMany({
        where: { householdId: membership.householdId, userId: { not: viewerId } },
        select: { userId: true, user: { select: { email: true, name: true } } },
      })
    : [];
  const partnerIds = partners.map((p) => p.userId);
  const accounts =
    partnerIds.length === 0
      ? []
      : await client.account.findMany({
          where: { userId: { in: partnerIds }, sharedWithHousehold: true },
          select: {
            id: true,
            userId: true,
            name: true,
            mask: true,
            type: true,
            subtype: true,
            currentBalanceCents: true,
          },
          orderBy: [{ userId: "asc" }, { name: "asc" }],
        });
  const accountIds = accounts.map((a) => a.id);

  return Object.freeze({
    partners: partners.map((p) => ({ userId: p.userId, email: p.user.email, name: p.user.name })),
    accounts,
    transactions: (where: Prisma.TransactionWhereInput = {}) =>
      client.transaction.findMany({
        where: { AND: [where, { accountId: { in: accountIds } }] },
        select: {
          id: true,
          accountId: true,
          date: true,
          amountCents: true,
          merchantName: true,
          description: true,
          pfcPrimary: true,
        },
        orderBy: [{ date: "desc" }, { id: "asc" }],
      }),
    findings: async () => {
      if (partnerIds.length === 0 || accountIds.length === 0) return [];
      const findings = await client.finding.findMany({
        where: { userId: { in: partnerIds }, status: { in: ["new", "shown"] } },
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          annualSavingsCents: true,
          evidence: true,
        },
        orderBy: [{ annualSavingsCents: "desc" }, { id: "asc" }],
      });
      const refs = findings.map((f) => evidenceRefs(f.evidence));
      const txIds = [...new Set(refs.flatMap((r) => r.transactionIds))];
      const placed = txIds.length
        ? await client.transaction.findMany({
            where: { id: { in: txIds }, accountId: { in: accountIds } },
            select: { id: true, accountId: true },
          })
        : [];
      const txAccount = new Map(placed.map((t) => [t.id, t.accountId]));
      const shared = new Set(accountIds);
      return findings
        .filter((_, i) => onSharedAccountsOnly(refs[i], shared, txAccount))
        .map((f) => ({
          id: f.id,
          userId: f.userId,
          type: f.type,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
        }));
    },
    // Spec step 198: the policies a household partner switched on for sharing, with the terms
    // a family comparison needs. Never an unshared policy, never a removed one.
    policies: () =>
      partnerIds.length === 0
        ? Promise.resolve([])
        : client.insurancePolicy.findMany({
            where: {
              userId: { in: partnerIds },
              sharedWithHousehold: true,
              status: { in: ["active", "pending"] },
            },
            select: {
              id: true,
              userId: true,
              kind: true,
              carrier: true,
              source: true,
              premiumCents: true,
              premiumFrequency: true,
              deductibleCents: true,
              coverage: true,
              covered: true,
            },
            orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
          }),
  });
}
