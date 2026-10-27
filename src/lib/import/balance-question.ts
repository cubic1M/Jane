import type { AccountKind } from "@/data-sources/types";

// The balance question for an uploaded account whose file doesn't carry one (cards, Wells
// Fargo), shared by the page and the server (src/lib/import/account-balance.ts).

export type BalanceAsk = { accountId: string; name: string; kind: AccountKind };

// What's owed on a card, what's in a bank account.
export function balanceQuestion(ask: Pick<BalanceAsk, "name" | "kind">): string {
  return ask.kind === "credit_card"
    ? `What do you owe on ${ask.name} today?`
    : `What's in ${ask.name} today?`;
}
