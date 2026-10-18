// Which accounts a finding is about, read from its evidence: account ids it names, and the
// transactions it lists (by id). Used to show a partner only findings that sit entirely on
// accounts shared with them. Pure.

export type EvidenceRefs = { accountIds: string[]; transactionIds: string[] };

export function evidenceRefs(evidence: unknown): EvidenceRefs {
  const accountIds = new Set<string>();
  const transactionIds = new Set<string>();
  const walk = (value: unknown, key = "") => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if ((key === "charges" || key === "transactions") && item && typeof item === "object") {
          const id = (item as { id?: unknown }).id;
          if (typeof id === "string") transactionIds.add(id);
        }
        if (key === "accounts" && item && typeof item === "object") {
          const id = (item as { id?: unknown }).id;
          if (typeof id === "string") accountIds.add(id);
        }
        walk(item);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "accountId" && typeof v === "string") accountIds.add(v);
        else walk(v, k);
      }
    }
  };
  walk(evidence);
  return { accountIds: [...accountIds].sort(), transactionIds: [...transactionIds].sort() };
}

// True when the finding names at least one account or transaction, and every one of them is
// on a shared account. Transactions the caller couldn't place on a shared account count as
// not shared.
export function onSharedAccountsOnly(
  refs: EvidenceRefs,
  sharedAccountIds: ReadonlySet<string>,
  sharedTransactionAccount: ReadonlyMap<string, string>,
): boolean {
  if (refs.accountIds.length === 0 && refs.transactionIds.length === 0) return false;
  return (
    refs.accountIds.every((id) => sharedAccountIds.has(id)) &&
    refs.transactionIds.every((id) => sharedAccountIds.has(sharedTransactionAccount.get(id) ?? ""))
  );
}
