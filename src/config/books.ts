// Books that balance (spec step 238): what Jane checks every day about the data it stands
// behind, and when it counts something as off.

// A balance that moves by more or less than the transactions between two snapshots, by more
// than this, is off.
export const BOOKS_TOLERANCE_CENTS = 100;
// Snapshots looked at, the last this many days.
export const BOOKS_LOOKBACK_DAYS = 45;
// A bank link that hasn't synced for this many days is stale (or broken).
export const BOOKS_STALE_DAYS = 4;
// An imported (CSV) account whose newest transaction is this many days old: its data ends there,
// said plainly, with a fresh import offered (real-user QA: a CSV account went quiet after a week,
// and its silence read as a missed paycheck).
export const BOOKS_IMPORT_STALE_DAYS = 7;
// A transfer out and a transfer in of the same amount in two of the person's accounts, this
// many days apart or less, are one move between their own accounts.
export const TRANSFER_MATCH_DAYS = 4;
// Transfers out with no match are worth saying (money going somewhere Jane can't see) from
// this amount.
export const UNMATCHED_TRANSFER_MIN_CENTS = 50_000;
// A transfer out whose description names a kind of account the person has linked arrived
// there, even when the bank reports it as an investment transaction (an HSA or IRA
// contribution) rather than a deposit: the word, and the account subtypes it means.
export const TRANSFER_TO_LINKED: Readonly<Record<string, readonly string[]>> = {
  hsa: ["hsa"],
  ira: ["ira", "roth", "roth ira", "traditional ira"],
  "401k": ["401k", "403b"],
  brokerage: ["brokerage"],
};
// Two accounts are the same when they share an account number's last digits, type and
// subtype. Plaid types of accounts whose balance owed is positive.
export const BOOKS_DEBT_TYPES: readonly string[] = ["credit", "loan"];
// The accounts whose balance moves only by their own transactions, so a balance that moves
// otherwise is a problem: checking, savings and cards. An investment account's value moves with
// prices, and a loan's with interest, its payments often showing on the paying account instead
// (real-user QA: a 401(k) that rose $1,227.67 in a day was "changed with no transactions").
export const BOOKS_RECONCILED_TYPES: readonly string[] = ["depository", "credit"];
// Plaid primary categories of transfers between accounts.
export const TRANSFER_OUT = "TRANSFER_OUT";
export const TRANSFER_IN = "TRANSFER_IN";
// Issue kinds that put a figure in doubt (an unmatched transfer is only said, not doubted), and
// those asked about at once (a link that needs a sign-in stops every figure on it).
export const BOOKS_WORRYING_KINDS: readonly string[] = [
  "off",
  "gap",
  "stale",
  "broken",
  "duplicate",
];
export const BOOKS_URGENT_KINDS: readonly string[] = ["broken"];
// Issue kinds, and how each is said.
export const BOOKS_KIND_LABELS: Readonly<Record<string, string>> = {
  off: "A balance that doesn't match its transactions",
  gap: "Transactions that stopped coming",
  stale: "A bank link that hasn't updated",
  broken: "A bank link that needs you to sign in again",
  duplicate: "The same account linked twice",
  transfer: "A transfer with no other side",
};
