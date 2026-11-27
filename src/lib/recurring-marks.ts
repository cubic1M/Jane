import { loadDetectionInput } from "@/detection/input";
import { recurringCharges, type RecurringCharge } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "@/data-sources/merchant";
import { scopedFor } from "@/lib/db-scoped";
import { frequencyWords } from "@/lib/explain-input";

// Which spending rows repeat, for the small mark on the Money, Transactions and month pages.
// One source of truth: the same recurring charges the Subscriptions page lists
// (recurringCharges, split into subscriptions and other regular bills the same way), never a
// second detection rule. A row is marked when its transaction is one the charge's stream is
// made of; only a stream with no transactions of ours (a Plaid stream) is found by the same
// merchant key and account instead. Pure, except loadRecurringCharges.

export type RepeatMark = {
  kind: "subscription" | "bill";
  // "Subscription · monthly" or "Repeats monthly": plain facts, no advice.
  label: string;
  // The charge's last amount, for a merchant row whose own figure is a total.
  amountCents: number;
  // The charge's row on /subscriptions.
  href: string;
};

export type RecurringMarks = {
  forTransaction: (t: {
    id?: string;
    accountId?: string;
    merchantName: string | null;
    description: string;
  }) => RepeatMark | null;
  forMerchant: (merchant: string) => RepeatMark | null;
};

// The id of a charge's row on /subscriptions (the page sets it; the mark links to it).
export const chargeAnchor = (key: string): string => `charge-${key}`;

export function markOf(charge: RecurringCharge): RepeatMark {
  const rhythm = frequencyWords(charge.frequency);
  return {
    kind: charge.subscription ? "subscription" : "bill",
    label: charge.subscription ? `Subscription · ${rhythm}` : `Repeats ${rhythm}`,
    amountCents: charge.lastAmountCents,
    href: `/subscriptions#${encodeURIComponent(chargeAnchor(charge.key))}`,
  };
}

const merchantKeyOf = (name: string): string | null => normalizeMerchant(name)?.key ?? null;

export function recurringMarks(charges: readonly RecurringCharge[]): RecurringMarks {
  // Biggest yearly cost first (recurringCharges' order): the first mark wins a shared key.
  const byTransaction = new Map<string, RepeatMark>();
  const byMerchant = new Map<string, RepeatMark>();
  const byMerchantAccount = new Map<string, RepeatMark>();
  for (const c of charges) {
    const mark = markOf(c);
    for (const id of c.transactionIds) if (!byTransaction.has(id)) byTransaction.set(id, mark);
    if (!byMerchant.has(c.merchantKey)) byMerchant.set(c.merchantKey, mark);
    if (c.transactionIds.length === 0 && c.accountId) {
      const k = `${c.merchantKey}|${c.accountId}`;
      if (!byMerchantAccount.has(k)) byMerchantAccount.set(k, mark);
    }
  }
  return {
    forTransaction: (t) => {
      if (t.id && byTransaction.has(t.id)) return byTransaction.get(t.id)!;
      const key = merchantKeyOf(t.merchantName ?? t.description);
      return key && t.accountId ? (byMerchantAccount.get(`${key}|${t.accountId}`) ?? null) : null;
    },
    forMerchant: (merchant) => {
      const key = merchantKeyOf(merchant);
      return key ? (byMerchant.get(key) ?? null) : null;
    },
  };
}

// The person's recurring charges as the Subscriptions page reads them: its input and the
// merchants they said are (or are not) a subscription. One detection read, matched in memory.
export async function loadRecurringCharges(
  userId: string,
  { client, now }: { client?: PrismaClient; now?: Date } = {},
): Promise<RecurringCharge[]> {
  const db = scopedFor(userId, client);
  const [input, checks] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    db.subscriptionChecks.findMany({ select: { merchantKey: true, isSubscription: true } }),
  ]);
  input.subscriptionMerchantKeys = checks.filter((c) => c.isSubscription).map((c) => c.merchantKey);
  input.declinedSubscriptionMerchantKeys = checks
    .filter((c) => !c.isSubscription)
    .map((c) => c.merchantKey);
  return recurringCharges(input);
}

export async function loadRecurringMarks(
  userId: string,
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<RecurringMarks> {
  return recurringMarks(await loadRecurringCharges(userId, options));
}
