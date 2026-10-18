import type { AccountBase, Transaction, TransactionStream } from "plaid";

// Made-up Plaid API objects for tests, with only the fields this app reads.

export function plaidAccount(overrides: Partial<AccountBase> = {}): AccountBase {
  return {
    account_id: "acc_checking",
    name: "Plaid Checking",
    official_name: null,
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: { current: 1234.56, available: 1200, limit: null, iso_currency_code: "USD" },
    ...overrides,
  } as AccountBase;
}

export function plaidTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    transaction_id: "txn_1",
    account_id: "acc_checking",
    date: "2026-10-01",
    amount: 15.49,
    name: "NETFLIX.COM",
    merchant_name: "Netflix",
    pending: false,
    personal_finance_category: {
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
      confidence_level: "VERY_HIGH",
    },
    ...overrides,
  } as Transaction;
}

export function plaidStream(overrides: Partial<TransactionStream> = {}): TransactionStream {
  return {
    stream_id: "stream_netflix",
    account_id: "acc_checking",
    description: "NETFLIX.COM",
    merchant_name: "Netflix",
    frequency: "MONTHLY",
    last_amount: { amount: 15.49 },
    average_amount: { amount: 15.49 },
    last_date: "2026-10-01",
    status: "MATURE",
    is_active: true,
    personal_finance_category: {
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
    },
    transaction_ids: ["txn_1"],
    ...overrides,
  } as TransactionStream;
}

type Page = {
  added?: Transaction[];
  modified?: Transaction[];
  removed?: { transaction_id: string; account_id: string }[];
  accounts?: AccountBase[];
  next_cursor: string;
  has_more?: boolean;
};

export function syncPage(page: Page) {
  return {
    data: {
      added: page.added ?? [],
      modified: page.modified ?? [],
      removed: page.removed ?? [],
      accounts: page.accounts ?? [plaidAccount()],
      next_cursor: page.next_cursor,
      has_more: page.has_more ?? false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      request_id: "req",
    },
  };
}

// What the Plaid SDK rejects with when the API answers with an error.
export function plaidApiError(errorCode: string, status = 400) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    config: { headers: { "PLAID-SECRET": "secret-should-never-leak" } },
    response: { status, data: { error_code: errorCode, error_type: "TRANSACTIONS_ERROR" } },
  });
}
