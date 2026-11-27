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
  // "Subscription · monthly", "Repeats monthly" or, for a merchant with several, "2 repeating
  // charges": plain facts, no advice.
  label: string;
  // The charge's last amount (the sum for a merchant with several charges at one rhythm), for a
  // merchant row whose own figure is a total. Null when the charges' rhythms differ.
  amountCents: number | null;
  // "a month" after the sum of several charges.
  per?: string;
  // The charge's row on /subscriptions (the first, for a merchant with several).
  href: string;
};

export type RecurringMarks = {
  forTransaction: (t: {
    id?: string;
    accountId?: string;
    merchantName: string | null;
    description: string;
    // The person's day of the payment (YYYY-MM-DD).
    date?: string;
  }) => RepeatMark | null;
  forMerchant: (merchant: string) => RepeatMark | null;
};

// The id of a charge's row on /subscriptions (the page sets it; the mark links to it).
export const chargeAnchor = (key: string): string => `charge-${key}`;

const PER: Partial<Record<RecurringCharge["frequency"], string>> = {
  WEEKLY: "a week",
  MONTHLY: "a month",
  ANNUALLY: "a year",
};

export function markOf(charge: RecurringCharge): RepeatMark {
  const rhythm = frequencyWords(charge.frequency);
  return {
    kind: charge.subscription ? "subscription" : "bill",
    label: charge.subscription ? `Subscription · ${rhythm}` : `Repeats ${rhythm}`,
    amountCents: charge.lastAmountCents,
    href: `/subscriptions#${encodeURIComponent(chargeAnchor(charge.key))}`,
  };
}

// One mark for a merchant: its charge's, or with several the count and their sum.
function merchantMarkOf(list: readonly RecurringCharge[]): RepeatMark {
  const [first] = list;
  if (list.length === 1) return markOf(first!);
  const sameRhythm = list.every((c) => c.frequency === first!.frequency);
  const per = PER[first!.frequency];
  return {
    kind: list.some((c) => c.subscription) ? "subscription" : "bill",
    label: `${list.length} repeating charges`,
    amountCents: sameRhythm ? list.reduce((n, c) => n + c.lastAmountCents, 0) : null,
    ...(sameRhythm && per ? { per } : {}),
    href: markOf(first!).href,
  };
}

const merchantKeyOf = (name: string): string | null => normalizeMerchant(name)?.key ?? null;

export function recurringMarks(charges: readonly RecurringCharge[]): RecurringMarks {
  // Biggest yearly cost first (recurringCharges' order): the first mark wins a shared key.
  const byTransaction = new Map<string, RepeatMark>();
  const byMerchant = new Map<string, RecurringCharge[]>();
  const byMerchantAccount = new Map<string, RecurringCharge[]>();
  for (const c of charges) {
    const mark = markOf(c);
    for (const id of c.transactionIds) if (!byTransaction.has(id)) byTransaction.set(id, mark);
    byMerchant.set(c.merchantKey, [...(byMerchant.get(c.merchantKey) ?? []), c]);
    if (c.accountId) {
      const k = `${c.merchantKey}|${c.accountId}`;
      byMerchantAccount.set(k, [...(byMerchantAccount.get(k) ?? []), c]);
    }
  }
  const merchantMarks = new Map([...byMerchant].map(([k, list]) => [k, merchantMarkOf(list)]));
  return {
    forTransaction: (t) => {
      if (t.id && byTransaction.has(t.id)) return byTransaction.get(t.id)!;
      // Not one of the stream's own transactions. The same merchant on the same account is
      // still the charge's when the payment is from outside the days the stream was read from
      // (older than the lookback, or dated after the last one read), or when there are no
      // transactions of ours behind the stream at all.
      const key = merchantKeyOf(t.merchantName ?? t.description);
      if (!key || !t.accountId) return null;
      const same = byMerchantAccount.get(`${key}|${t.accountId}`) ?? [];
      const own = same.find(
        (c) =>
          c.transactionIds.length === 0 ||
          (t.date !== undefined &&
            c.firstChargeDate !== null &&
            c.lastChargeDate !== null &&
            (t.date < c.firstChargeDate || t.date > c.lastChargeDate)),
      );
      return own ? markOf(own) : null;
    },
    forMerchant: (merchant) => {
      const key = merchantKeyOf(merchant);
      return key ? (merchantMarks.get(key) ?? null) : null;
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
