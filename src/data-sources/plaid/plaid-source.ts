import type { AccountBase, PlaidApi, Transaction } from "plaid";
import { PersonalFinanceCategoryVersion } from "plaid";
import { SYNC_MAX_RESTARTS, SYNC_PAGE_SIZE, SYNC_RETRY_ATTEMPTS } from "@/config/plaid";
import { plaidCall, plaidErrorCode } from "@/lib/plaid/client";
import { backoffMs, retryablePlaidError } from "@/lib/plaid/retry";
import {
  keepsTransactions,
  syncedKindOf,
  type DataSource,
  type NormalizedAccount,
  type NormalizedTransaction,
  type SourceBatch,
} from "../types";

// Plaid as a DataSource: one /transactions/sync run for an item, from its saved cursor.
// Besides the batch, a sync returns what Plaid removed and the cursor to save. Only the
// account kinds the app understands are kept: checking, savings and credit cards with
// their transactions, and loans and investments (spec steps 65–66) for their balances only.

export type PlaidSync = SourceBatch & {
  removedTransactionIds: string[];
  nextCursor: string;
};

// The most a cents column holds (32 bits). Past it, saving throws and the bank stops syncing.
const MAX_CENTS = 2_147_483_647;

// Plaid amounts are dollars as floats; money in the app is integer cents. An amount too big to
// keep counts as not known, like any other amount Plaid doesn't give.
export const toCents = (dollars: number | null | undefined): number | null => {
  if (dollars === null || dollars === undefined) return null;
  const cents = Math.round(dollars * 100);
  return Math.abs(cents) <= MAX_CENTS ? cents : null;
};

// Money in the app is US dollars. A transaction or balance in another currency (an account held
// abroad, or a crypto wallet's unofficial code) can't be added to dollars, so it's left out rather
// than counted as if it were dollars (messy-bank QA: EUR 35.00 read as $35.00). A card's
// foreign purchases are already converted by the card company and come in USD.
export const inDollars = (
  t: Pick<Transaction, "iso_currency_code" | "unofficial_currency_code">,
) => (t.iso_currency_code ? t.iso_currency_code === "USD" : !t.unofficial_currency_code);

// Any account Plaid returns: /transactions/sync's, /liabilities/get's or
// /investments/holdings/get's, which share these fields.
type PlaidAccount = Pick<
  AccountBase,
  "account_id" | "name" | "official_name" | "mask" | "type" | "subtype" | "balances"
>;

export function normalizeAccount(account: PlaidAccount): NormalizedAccount | null {
  const kind = syncedKindOf(account.type, account.subtype ?? null);
  if (!kind) return null;
  return {
    ref: account.account_id,
    name: account.official_name ?? account.name,
    kind,
    mask: account.mask ?? null,
    currentBalanceCents: inDollars(account.balances) ? toCents(account.balances.current) : null,
    ...(kind === "retirement" || kind === "investment_account"
      ? { plaidSubtype: account.subtype?.toLowerCase() ?? null }
      : {}),
  };
}

export function normalizeTransaction(t: Transaction): NormalizedTransaction {
  return {
    accountRef: t.account_id,
    date: t.date,
    amountCents: toCents(t.amount) ?? 0,
    description: t.name,
    merchantName: t.merchant_name ?? null,
    categoryPrimary: t.personal_finance_category?.primary ?? null,
    categoryDetailed: t.personal_finance_category?.detailed ?? null,
    pending: t.pending,
    externalId: t.transaction_id,
    pendingExternalId: t.pending_transaction_id ?? null,
    hints: {},
  };
}

export class PlaidDataSource implements DataSource {
  readonly kind = "plaid" as const;

  constructor(
    private readonly api: PlaidApi,
    private readonly accessToken: string,
    private readonly cursor: string | null,
    // Waits between retries; the tests pass one that doesn't.
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  // Reads every page since the cursor. A failed page restarts the whole run from the original
  // cursor, as Plaid requires: at once if Plaid's data changed mid-way, after a growing wait
  // for a failure that passes (a rate limit, an outage). Nothing is saved until it all reads.
  async load(): Promise<PlaidSync> {
    let restarts = 0;
    let retries = 0;
    for (;;) {
      try {
        return await this.readAllPages();
      } catch (error) {
        if (plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
          if (restarts >= SYNC_MAX_RESTARTS) throw error;
          restarts += 1;
        } else if (retryablePlaidError(error) && retries + 1 < SYNC_RETRY_ATTEMPTS) {
          await this.sleep(backoffMs(retries));
          retries += 1;
        } else throw error;
      }
    }
  }

  private async readAllPages(): Promise<PlaidSync> {
    const accounts = new Map<string, AccountBase>();
    const changed = new Map<string, Transaction>();
    const removed = new Set<string>();
    let cursor = this.cursor ?? undefined;

    for (;;) {
      const data = await plaidCall(
        this.api.transactionsSync({
          access_token: this.accessToken,
          cursor,
          count: SYNC_PAGE_SIZE,
          options: { personal_finance_category_version: PersonalFinanceCategoryVersion.V2 },
        }),
      );
      for (const account of data.accounts) accounts.set(account.account_id, account);
      for (const t of [...data.added, ...data.modified]) {
        changed.set(t.transaction_id, t);
        removed.delete(t.transaction_id);
      }
      for (const r of data.removed) {
        if (r.transaction_id) {
          removed.add(r.transaction_id);
          changed.delete(r.transaction_id);
        }
      }
      cursor = data.next_cursor;
      if (!data.has_more) break;
    }

    const kept = [...accounts.values()]
      .map(normalizeAccount)
      .filter((a): a is NormalizedAccount => a !== null);
    const keptRefs = new Set(kept.filter((a) => keepsTransactions(a.kind)).map((a) => a.ref));
    return {
      accounts: kept,
      transactions: [...changed.values()]
        .filter((t) => keptRefs.has(t.account_id) && inDollars(t) && toCents(t.amount) !== null)
        .map(normalizeTransaction),
      skipped: [],
      removedTransactionIds: [...removed],
      nextCursor: cursor ?? "",
    };
  }
}
