import type { PlaidApi } from "plaid";
import { describe, expect, it, vi } from "vitest";
import { PlaidRequestError } from "@/lib/plaid/client";
import { plaidAccount, plaidApiError, plaidTransaction, syncPage } from "./__fixtures__/plaid";
import { PlaidDataSource, normalizeAccount, normalizeTransaction } from "./plaid-source";

function apiWith(transactionsSync: ReturnType<typeof vi.fn>) {
  return { transactionsSync } as unknown as PlaidApi;
}

describe("normalizeTransaction", () => {
  it("keeps Plaid's sign, converts dollars to cents and keeps the category", () => {
    expect(normalizeTransaction(plaidTransaction({ amount: -1200.1 }))).toEqual({
      accountRef: "acc_checking",
      date: "2026-10-01",
      amountCents: -120010,
      description: "NETFLIX.COM",
      merchantName: "Netflix",
      categoryPrimary: "ENTERTAINMENT",
      categoryDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      pending: false,
      externalId: "txn_1",
      hints: {},
    });
  });
});

describe("normalizeAccount", () => {
  it("maps checking, savings and credit cards", () => {
    expect(normalizeAccount(plaidAccount())).toMatchObject({ kind: "checking", mask: "0000" });
    expect(
      normalizeAccount(plaidAccount({ type: "credit", subtype: "credit card" } as never)),
    ).toMatchObject({ kind: "credit_card", currentBalanceCents: 123456 });
  });

  it("keeps loans and investments, and skips account kinds the app doesn't use", () => {
    expect(
      normalizeAccount(plaidAccount({ type: "loan", subtype: "mortgage" } as never))?.kind,
    ).toBe("mortgage");
    expect(
      normalizeAccount(plaidAccount({ type: "loan", subtype: "home equity loan" } as never))?.kind,
    ).toBe("other_loan");
    expect(
      normalizeAccount(plaidAccount({ type: "investment", subtype: "401k" } as never))?.kind,
    ).toBe("retirement");
    expect(
      normalizeAccount(plaidAccount({ type: "brokerage", subtype: null } as never))?.kind,
    ).toBe("investment_account");
    expect(normalizeAccount(plaidAccount({ type: "other", subtype: null } as never))).toBeNull();
  });
});

describe("PlaidDataSource", () => {
  it("reads every page from the saved cursor and returns the next cursor", async () => {
    const sync = vi
      .fn()
      .mockResolvedValueOnce(
        syncPage({ added: [plaidTransaction()], next_cursor: "c1", has_more: true }),
      )
      .mockResolvedValueOnce(
        syncPage({ added: [plaidTransaction({ transaction_id: "txn_2" })], next_cursor: "c2" }),
      );

    const batch = await new PlaidDataSource(apiWith(sync), "access-sandbox-x", "c0").load();

    expect(sync.mock.calls.map((c) => c[0].cursor)).toEqual(["c0", "c1"]);
    expect(sync.mock.calls[0][0].options).toEqual({ personal_finance_category_version: "v2" });
    expect(batch.transactions.map((t) => t.externalId)).toEqual(["txn_1", "txn_2"]);
    expect(batch.nextCursor).toBe("c2");
  });

  it("returns modified transactions and removals, latest change winning", async () => {
    const sync = vi.fn().mockResolvedValueOnce(
      syncPage({
        added: [plaidTransaction({ transaction_id: "gone" })],
        modified: [plaidTransaction({ transaction_id: "txn_1", amount: 17.99 })],
        removed: [{ transaction_id: "gone", account_id: "acc_checking" }],
        next_cursor: "c1",
      }),
    );

    const batch = await new PlaidDataSource(apiWith(sync), "access-sandbox-x", null).load();

    expect(batch.transactions.map((t) => [t.externalId, t.amountCents])).toEqual([["txn_1", 1799]]);
    expect(batch.removedTransactionIds).toEqual(["gone"]);
  });

  it("keeps loan accounts for their balance, but not their transactions", async () => {
    const loan = plaidAccount({ account_id: "acc_loan", type: "loan", subtype: "auto" } as never);
    const sync = vi.fn().mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount(), loan],
        added: [
          plaidTransaction(),
          plaidTransaction({ transaction_id: "t2", account_id: "acc_loan" }),
        ],
        next_cursor: "c1",
      }),
    );

    const batch = await new PlaidDataSource(apiWith(sync), "access-sandbox-x", null).load();

    expect(batch.accounts.map((a) => [a.ref, a.kind])).toEqual([
      ["acc_checking", "checking"],
      ["acc_loan", "auto_loan"],
    ]);
    expect(batch.transactions.map((t) => t.externalId)).toEqual(["txn_1"]);
  });

  it("restarts from the original cursor when data changes mid-pagination", async () => {
    const sync = vi
      .fn()
      .mockResolvedValueOnce(syncPage({ next_cursor: "c1", has_more: true }))
      .mockRejectedValueOnce(plaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
      .mockResolvedValueOnce(syncPage({ added: [plaidTransaction()], next_cursor: "c9" }));

    const batch = await new PlaidDataSource(apiWith(sync), "access-sandbox-x", "c0").load();

    expect(sync.mock.calls.map((c) => c[0].cursor)).toEqual(["c0", "c1", "c0"]);
    expect(batch.nextCursor).toBe("c9");
  });

  it("gives up after a few restarts, and other errors aren't retried", async () => {
    const mutating = vi
      .fn()
      .mockRejectedValue(plaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"));
    await expect(
      new PlaidDataSource(apiWith(mutating), "access-sandbox-x", null).load(),
    ).rejects.toBeInstanceOf(PlaidRequestError);
    expect(mutating).toHaveBeenCalledTimes(4);

    const broken = vi.fn().mockRejectedValue(plaidApiError("ITEM_LOGIN_REQUIRED"));
    await expect(
      new PlaidDataSource(apiWith(broken), "access-sandbox-x", null).load(),
    ).rejects.toMatchObject({ code: "ITEM_LOGIN_REQUIRED" });
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("never carries the request (access token, secret) in its errors", async () => {
    const broken = vi.fn().mockRejectedValue(plaidApiError("INTERNAL_SERVER_ERROR", 500));

    const error = await new PlaidDataSource(apiWith(broken), "access-sandbox-secret", null)
      .load()
      .catch((e: unknown) => e);

    const dumped =
      JSON.stringify(error) + String(error) + JSON.stringify(Object.entries(error as object));
    expect(dumped).not.toContain("access-sandbox-secret");
    expect(dumped).not.toContain("secret-should-never-leak");
  });
});
