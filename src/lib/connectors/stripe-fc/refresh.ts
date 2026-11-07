import { STRIPE_FC } from "@/config/connectors";

// When a Stripe Financial Connections account's balance may be asked for again: at most weekly, since
// each call costs (round 20). Never on a page view. Pure.
export function balanceRefreshDue(lastRefreshedAt: Date | null, now: Date): boolean {
  if (!lastRefreshedAt) return true;
  return now.getTime() - lastRefreshedAt.getTime() >= STRIPE_FC.balanceRefreshDays * 86_400_000;
}

// The earliest day of transactions Stripe can give for a new link (YYYY-MM-DD).
export function historyFrom(now: Date): string {
  return new Date(now.getTime() - STRIPE_FC.historyDays * 86_400_000).toISOString().slice(0, 10);
}

type LinkedAccount = { institution: string; mask: string | null; type: string };

const bank = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:bank|n\.?a\.?|national association|financial|credit union|fcu|inc|corp)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The same account linked through two sources (Plaid and Stripe): the same bank, the same last four
// and the same kind of account. Without a mask, never assumed the same. Pure.
export function sameBankAccount(a: LinkedAccount, b: LinkedAccount): boolean {
  if (!a.mask || !b.mask || a.mask !== b.mask) return false;
  return a.type === b.type && bank(a.institution) === bank(b.institution);
}
