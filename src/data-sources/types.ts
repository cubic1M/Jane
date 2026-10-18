// Every way data enters the app (CSV uploads now, Plaid from step 7) produces these
// shapes, so storage, categorization and detection never care where data came from.

export type DataSourceKind = "csv" | "plaid";

// The account kinds a person picks on /import, mapped to Plaid's type/subtype values
// so Plaid accounts and CSV accounts look the same in the database.
export const ACCOUNT_KINDS = {
  checking: { label: "Checking", type: "depository", subtype: "checking" },
  savings: { label: "Savings", type: "depository", subtype: "savings" },
  credit_card: { label: "Credit card", type: "credit", subtype: "credit card" },
} as const;

export type AccountKind = keyof typeof ACCOUNT_KINDS;

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && Object.hasOwn(ACCOUNT_KINDS, value);
}

export function accountKindOf(type: string, subtype: string | null): AccountKind | null {
  for (const [kind, plaid] of Object.entries(ACCOUNT_KINDS)) {
    if (plaid.type === type && plaid.subtype === subtype) return kind as AccountKind;
  }
  return null;
}

// Loans come from Plaid only (spec step 65): their balances count toward net worth and
// their rates and payments come from Plaid Liabilities. Their transactions aren't kept,
// since spending and detection read the checking and card side of each payment.
export const LOAN_KINDS = {
  mortgage: { label: "Mortgage", type: "loan", subtype: "mortgage" },
  student_loan: { label: "Student loan", type: "loan", subtype: "student" },
  auto_loan: { label: "Car loan", type: "loan", subtype: "auto" },
  other_loan: { label: "Loan", type: "loan", subtype: "loan" },
} as const;

export type LoanKind = keyof typeof LOAN_KINDS;

// Investment and retirement accounts (spec step 66): their balances only, for net worth.
// No holdings, no transactions, and nothing said about what's in them.
export const INVESTMENT_KINDS = {
  retirement: { label: "Retirement account", type: "investment", subtype: "retirement" },
  investment_account: { label: "Investment account", type: "investment", subtype: "brokerage" },
} as const;

export type InvestmentKind = keyof typeof INVESTMENT_KINDS;

// Plaid investment subtypes that are retirement accounts (plaid SDK AccountSubtype).
const RETIREMENT_SUBTYPES = new Set([
  "401a",
  "401k",
  "403b",
  "457b",
  "ira",
  "roth",
  "roth 401k",
  "roth 403b",
  "roth 457b",
  "sep ira",
  "simple ira",
  "sarsep",
  "keogh",
  "pension",
  "roth pension",
  "retirement",
  "thrift savings plan",
  "roth thrift savings plan",
  "profit sharing plan",
  "roth profit sharing plan",
]);

export type SyncedKind = AccountKind | LoanKind | InvestmentKind;

export const SYNCED_KINDS = { ...ACCOUNT_KINDS, ...LOAN_KINDS, ...INVESTMENT_KINDS } as const;

export const isLoanKind = (kind: SyncedKind): kind is LoanKind => Object.hasOwn(LOAN_KINDS, kind);

// Whether an account's transactions are kept: checking, savings and cards. Loans and
// investments are kept for their balances only.
export const keepsTransactions = (kind: SyncedKind) => Object.hasOwn(ACCOUNT_KINDS, kind);

// Any kind Plaid accounts are kept as. Other loan subtypes (e.g. "home equity loan") are
// kept as a plain loan; investment accounts (type "brokerage" in old API versions) as
// retirement or investment accounts.
export function syncedKindOf(type: string, subtype: string | null): SyncedKind | null {
  if (type === "investment" || type === "brokerage") {
    return RETIREMENT_SUBTYPES.has((subtype ?? "").toLowerCase())
      ? "retirement"
      : "investment_account";
  }
  for (const [kind, plaid] of Object.entries(SYNCED_KINDS)) {
    if (plaid.type === type && plaid.subtype === subtype) return kind as SyncedKind;
  }
  return type === "loan" ? "other_loan" : null;
}

export type NormalizedAccount = {
  // Stable id within the source: the Plaid account id, or our own id for CSV accounts.
  ref: string;
  name: string;
  kind: SyncedKind;
  mask: string | null;
  currentBalanceCents: number | null;
};

export type NormalizedTransaction = {
  accountRef: string;
  // YYYY-MM-DD, the date the bank posted the transaction.
  date: string;
  // Plaid's convention: positive is money out of the account, negative is money in.
  amountCents: number;
  description: string;
  merchantName: string | null;
  // Plaid personal finance categories, when the source already knows them.
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  pending: boolean;
  // The source's own transaction id (Plaid), or a dedupe key for sources without one (CSV).
  externalId: string;
  // Extra hints from the source (e.g. the bank's own category) for our categorizer.
  hints: { bankCategory?: string; bankType?: string };
};

// A row the source could not use, with a reason a person can act on.
export type SkippedRow = { file: string; line: number; reason: string };

export type SourceBatch = {
  accounts: NormalizedAccount[];
  transactions: NormalizedTransaction[];
  skipped: SkippedRow[];
};

export interface DataSource {
  readonly kind: DataSourceKind;
  load(): Promise<SourceBatch>;
}
