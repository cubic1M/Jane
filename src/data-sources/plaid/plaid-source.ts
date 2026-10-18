import type { AccountBase, PlaidApi, Transaction } from "plaid";
import { PersonalFinanceCategoryVersion } from "plaid";
import { SYNC_MAX_RESTARTS, SYNC_PAGE_SIZE } from "@/config/plaid";
import { plaidCall, plaidErrorCode } from "@/lib/plaid/client";
import {
  accountKindOf,
  type DataSource,
  type NormalizedAccount,
  type NormalizedTransaction,
  type SourceBatch,
} from "../types";

// Plaid as a DataSource: one /transactions/sync run for an item, from its saved cursor.
// Besides the batch, a sync returns what Plaid removed and the cursor to save. Only the
// account kinds the app understands (checking, savings, credit card) are kept.

export type PlaidSync = SourceBatch & {
  removedTransactionIds: string[];
  nextCursor: string;
};

// Plaid amounts are dollars as floats; money in the app is integer cents.
export const toCents = (dollars: number | null | undefined): number | null =>
  dollars === null || dollars === undefined ? null : Math.round(dollars * 100);

export function normalizeAccount(account: AccountBase): NormalizedAccount | null {
  const kind = accountKindOf(account.type, account.subtype ?? null);
  if (!kind) return null;
  return {
    ref: account.account_id,
    name: account.official_name ?? account.name,
    kind,
    mask: account.mask ?? null,
    currentBalanceCents: toCents(account.balances.current),
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
    hints: {},
  };
}

export class PlaidDataSource implements DataSource {
  readonly kind = "plaid" as const;

  constructor(
    private readonly api: PlaidApi,
    private readonly accessToken: string,
    private readonly cursor: string | null,
  ) {}

  // Reads every page since the cursor. If Plaid's data changes mid-way, the whole run
  // restarts from the original cursor, as Plaid requires.
  async load(): Promise<PlaidSync> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.readAllPages();
      } catch (error) {
        const restart =
          plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
          attempt < SYNC_MAX_RESTARTS;
        if (!restart) throw error;
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
    const keptRefs = new Set(kept.map((a) => a.ref));
    return {
      accounts: kept,
      transactions: [...changed.values()]
        .filter((t) => keptRefs.has(t.account_id))
        .map(normalizeTransaction),
      skipped: [],
      removedTransactionIds: [...removed],
      nextCursor: cursor ?? "",
    };
  }
}
