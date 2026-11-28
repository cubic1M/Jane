import { categoryOf } from "@/categorize/taxonomy";
import { merchantOf } from "@/detection/streams";
import { recurringCharges } from "@/detection/subscriptions";
import type { DetectionInput } from "@/detection/types";
import type { ProfileInput, ProfileTx, RecurringRow } from "@/profile/build";

// ONE source of truth for "this charge recurs": the rows of the Subscriptions and regular bills
// page (src/detection/subscriptions.ts recurringCharges). Any card that says something is a
// subscription or a recurring charge may name only a merchant on that list (founder 11-28: two
// Starbucks drinks a year apart read as "a trial now billing you, saving $34 a year").
// The loader hands over the page's own rows (extras.subscriptions.recurring); the sample people
// have none, so theirs are worked out here from their charges by the same function.

export type { RecurringRow };

const cache = new WeakMap<object, readonly RecurringRow[]>();

function detectionInputOf(data: ProfileInput): DetectionInput {
  return {
    asOf: data.today,
    accounts: data.accounts.map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      type: a.type,
      subtype: a.subtype,
      currentBalanceCents: a.balanceCents,
    })),
    transactions: data.transactions.map((t: ProfileTx, i) => ({
      id: `${i}`,
      accountId: t.accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchantName: t.merchantName ?? null,
      pfcPrimary: t.pfc ? (categoryOf(t.pfc)?.primary ?? null) : null,
      pfcDetailed: t.pfc,
      categorySource: null,
      ...(t.uploadedOn ? { uploadedOn: t.uploadedOn } : {}),
    })),
    recurringStreams: [],
  };
}

export function recurringRowsOf(data: ProfileInput): readonly RecurringRow[] {
  const given = data.extras?.subscriptions?.recurring;
  if (given) return given;
  const hit = cache.get(data);
  if (hit) return hit;
  const rows = recurringCharges(detectionInputOf(data)).map((r) => ({
    merchantKey: r.merchantKey,
    subscription: r.subscription,
    lastAmountCents: r.lastAmountCents,
    annualCostCents: r.annualCostCents,
  }));
  cache.set(data, rows);
  return rows;
}

export const merchantKeyOf = (t: Pick<ProfileTx, "merchantName" | "description">): string =>
  merchantOf({ merchantName: t.merchantName ?? null, description: t.description })?.key ?? "";

// The page's row for a merchant, the subscriptions list only when `subscriptionOnly`.
export function recurringRowFor(
  data: ProfileInput,
  t: Pick<ProfileTx, "merchantName" | "description"> & { amountCents?: number },
  subscriptionOnly: boolean,
): RecurringRow | null {
  const key = merchantKeyOf(t);
  if (!key) return null;
  const rows = recurringRowsOf(data).filter(
    (r) => r.merchantKey === key && (!subscriptionOnly || r.subscription),
  );
  // The plan the charge is at (a merchant can have a monthly and a yearly one), else the dearest,
  // as the page lists it first.
  const own = rows.find((r) => r.lastAmountCents === t.amountCents);
  if (own) return own;
  return rows.sort((a, b) => b.annualCostCents - a.annualCostCents)[0] ?? null;
}
