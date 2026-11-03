import type { ScopedDb } from "@/lib/db-scoped";

// "Download my data" says everything: the rest of what's held about the person, table by table, so a
// new table is in the file without anyone remembering to add it. The tables written out by hand in
// data-export.ts are left out here. About 65 weren't in the file at all (medical bills, credit
// disputes, tax notices, identity cases, children...).

const WRITTEN_OUT = new Set([
  "accounts",
  "actions",
  "agentMessages",
  "alerts",
  "askConversations",
  "autopilotActs",
  "autopilotSectors",
  "balanceSnapshots",
  "balanceTransfers",
  "booksIssues",
  "budgetTuneUps",
  "budgets",
  "changeAcks",
  "checkIns",
  "controllerRuns",
  "deadlines",
  "debtPlans",
  "debtTerms",
  "decisions",
  "digests",
  "documents",
  "findings",
  "goalTransfers",
  "healthScores",
  "janeMessages",
  "janePreferences",
  "leanPlans",
  "liabilities",
  "lifeEventAnswers",
  "lifeEvents",
  "loanApplications",
  "membershipIntents",
  "merchantCategories",
  "mfaBackupCodes",
  "moneyTransfers",
  "monthCloses",
  "monthlyReports",
  "ownedAssets",
  "paycheckPlans",
  "plaidItems",
  "planLinks",
  "planProposals",
  "pushSubscriptions",
  "recurringStreams",
  "refinanceChecks",
  "savedShares",
  "savingsGoals",
  "standingRules",
  "studentLoanProfiles",
  "subscriptionChecks",
  "suggestionOutcomes",
  "suggestions",
  "taxDocuments",
  "taxForms",
  "taxProfiles",
  "taxReturns",
  "taxTags",
  "transactions",
  "unusualAnswers",
  "userFacts",
  "whatIfPlans",
  "yearPlans",
]);

// Columns that work as a key, or say nothing about the person, whatever table they're in.
const NEVER = /encrypted|token|hash|secret|cursor|p256dh|^auth$|^userId$/i;
const AT_ONCE = 6;

type Table = { findMany: () => Promise<Record<string, unknown>[]> };

function isTable(value: unknown): value is Table {
  return typeof (value as Partial<Table> | null)?.findMany === "function";
}

function withoutKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([column]) => !NEVER.test(column))
      .map(([column, value]) => [column, typeof value === "bigint" ? String(value) : value]),
  );
}

export async function restOfTheirData(db: ScopedDb): Promise<Record<string, unknown[]>> {
  const names = Object.keys(db).filter(
    (name) => !WRITTEN_OUT.has(name) && isTable((db as Record<string, unknown>)[name]),
  );
  const rest: Record<string, unknown[]> = {};
  for (let i = 0; i < names.length; i += AT_ONCE) {
    await Promise.all(
      names.slice(i, i + AT_ONCE).map(async (name) => {
        const table = (db as Record<string, unknown>)[name] as Table;
        const rows = await table.findMany();
        if (rows.length > 0) rest[name] = rows.map(withoutKeys);
      }),
    );
  }
  return rest;
}
