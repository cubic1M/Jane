// Which tables a page may answer from one read of the person's rows instead of one query for each
// question (src/lib/row-snapshots.ts, docs/perf/fast-pages.md): the small ones, with the most rows
// a person's table may have before it is read the usual way (a table that grew past it is asked of
// the database as before, and costs nothing extra), and the columns that are never copied into
// memory.
export const WHOLE_TABLES: Readonly<
  Record<string, { maxRows: number; hidden?: readonly string[] }>
> = {
  Account: { maxRows: 400 },
  PlaidItem: { maxRows: 100, hidden: ["accessTokenEncrypted"] },
  TaxProfile: { maxRows: 10 },
  Liability: { maxRows: 300 },
  OwnedAsset: { maxRows: 300 },
  LifeEvent: { maxRows: 300 },
  Suggestion: { maxRows: 3000 },
  Finding: { maxRows: 3000 },
  Action: { maxRows: 1000 },
  SavingsGoal: { maxRows: 200 },
  Budget: { maxRows: 300 },
  InsuranceProfile: { maxRows: 10 },
  InsurancePolicy: { maxRows: 300 },
  InvestorProfile: { maxRows: 10 },
  User: { maxRows: 1, hidden: ["mfaSecretEncrypted", "calendarTokenHash"] },
};

// The tables that only grow with the days (the transactions, the balances, the investment moves):
// one read of the rows from the start of last year, for every question about a span inside it (a
// question about earlier days, or none, is asked of the database as before, except for the newest
// rows), and the most rows each will hold.
export const WINDOWED_TABLES: Readonly<Record<string, { maxRows: number }>> = {
  Transaction: { maxRows: 30_000 },
  BalanceSnapshot: { maxRows: 20_000 },
  InvestmentTransaction: { maxRows: 10_000 },
};
