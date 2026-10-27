import { actionWorthCents } from "@/lib/saved-amount";
import { randomBytes } from "node:crypto";
import { CHARGES_PER_YEAR, type Frequency } from "@/config/detection";
import { CANCEL_GRACE_DAYS, LOWER_BILL_LOOK_DAYS, SHARE_TOKEN_BYTES } from "@/config/saved";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { merchantOf } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { addDays, isoDate } from "@/detection/units";
import { switchOf } from "@/lib/agent/switch";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { snapshotTitle } from "@/lib/hubs/jane";
import { formatCents } from "@/lib/money";
import { savingsRecord, type SavingsRecord } from "@/lib/outcomes";
import { dayLabel } from "@/lib/day-label";
import { sha256Hex } from "@/lib/hash";

// What Jane saved you (spec step 139). Only what the person's own transactions show counts
// as confirmed, each with its receipt: a refund that came back, a lower bill that arrived,
// a new plan's first bill, a cancelled charge that stopped coming. Everything else Jane did
// or is doing stays an estimate, shown apart and never added to the confirmed total.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export type ReceiptKind = "refund" | "lower_bill" | "switched" | "cancelled";

export type Receipt = {
  actionId: string;
  title: string;
  kind: ReceiptKind;
  // A refund once; a lower bill or a cancellation a year.
  cents: number;
  yearly: boolean;
  // The transaction that shows it (for a cancellation, the last charge before it stopped).
  seen: { date: string; description: string; amountCents: number };
  // One line on what the transaction shows.
  proof: string;
};

export type Estimate = { actionId: string; title: string; cents: number; why: string };

export type ProvenSavings = {
  confirmed: Receipt[];
  confirmedCents: number;
  estimated: Estimate[];
  estimatedCents: number;
  // Spec step 207: finished long ago and the saving never showed up. Not counted.
  notShown: Estimate[];
};

type Evidence = {
  merchant?: unknown;
  frequency?: unknown;
  lastAmountCents?: unknown;
  annualCostCents?: unknown;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const keyOf = (name: unknown) =>
  typeof name === "string" ? (normalizeMerchant(name)?.key ?? null) : null;
const view = (t: DetectionTransaction) => ({
  date: t.date,
  description: t.description,
  amountCents: t.amountCents,
});
const estimateOf = (snapshot: unknown) =>
  num((snapshot as { annualSavingsCents?: unknown } | null)?.annualSavingsCents) ?? 0;

export async function provenSavings(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<ProvenSavings> {
  const db = scopedFor(userId, client);
  const [actions, input] = await Promise.all([
    db.actions.findMany({
      where: { status: { in: ["done", "queued", "in_progress", "waiting_on_user"] } },
      select: {
        id: true,
        type: true,
        status: true,
        startedAt: true,
        completedAt: true,
        refundSeenAt: true,
        refundCents: true,
        cancelledOn: true,
        confirmedAnnualCents: true,
        savingMissedAt: true,
        decision: {
          select: { cardSnapshot: true, options: true, finding: { select: { evidence: true } } },
        },
      },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    }),
    given ?? loadDetectionInput(userId, { client, now }),
  ]);
  const asOf = isoDate(now);
  const charges = input.transactions.filter((t) => t.amountCents > 0);
  const from = (key: string | null) =>
    key ? charges.filter((t) => merchantOf(t)?.key === key) : [];

  const confirmed: Receipt[] = [];
  const estimated: Estimate[] = [];
  const notShown: Estimate[] = [];
  for (const action of actions) {
    const title = snapshotTitle(action.decision.cardSnapshot);
    const estimate = estimateOf(action.decision.cardSnapshot);
    const evidence = (action.decision.finding.evidence ?? {}) as Evidence;
    const done = action.status === "done";
    const since = isoDate(action.completedAt ?? action.startedAt ?? now);
    const receipt = (r: Omit<Receipt, "actionId" | "title">) =>
      confirmed.push({ actionId: action.id, title, ...r });

    // A refund that came back in the person's own transactions (spec step 52).
    if (done && action.refundCents !== null && action.refundSeenAt) {
      const day = isoDate(action.refundSeenAt);
      const back = input.transactions.find(
        (t) => t.date === day && t.amountCents === -action.refundCents!,
      );
      if (back) {
        receipt({
          kind: "refund",
          cents: action.refundCents,
          yearly: false,
          seen: view(back),
          proof: `${formatCents(action.refundCents)} came back on ${dayLabel(back.date, { year: true })}.`,
        });
        continue;
      }
    }

    // A switch: the new plan's first bill (spec steps 76–77).
    const switched = switchOf(action.decision.options);
    if (done && switched && action.confirmedAnnualCents !== null) {
      const first = from(keyOf(switched.name)).find((t) => t.date >= since);
      if (first) {
        receipt({
          kind: "switched",
          cents: action.confirmedAnnualCents,
          yearly: true,
          seen: view(first),
          proof: `${switched.name}'s first bill, ${formatCents(first.amountCents)}, came on ${dayLabel(first.date, { year: true })}.`,
        });
        continue;
      }
    }

    // A lower price (a call, a price fight): a bill below the old price after the work.
    const oldPrice = num(evidence.lastAmountCents);
    if (done && !switched && action.confirmedAnnualCents !== null && oldPrice !== null) {
      const lower = from(keyOf(evidence.merchant)).find(
        (t) =>
          t.date >= since &&
          t.date <= addDays(since, LOWER_BILL_LOOK_DAYS) &&
          t.amountCents < oldPrice,
      );
      if (lower) {
        receipt({
          kind: "lower_bill",
          cents: action.confirmedAnnualCents,
          yearly: true,
          seen: view(lower),
          proof: `The bill came in at ${formatCents(lower.amountCents)} on ${dayLabel(lower.date, { year: true })}, down from ${formatCents(oldPrice)}.`,
        });
        continue;
      }
    }

    // A cancellation: the next charge was due and never came.
    const frequency = evidence.frequency as Frequency | undefined;
    const perYear = frequency ? CHARGES_PER_YEAR[frequency] : undefined;
    if (done && action.type === "cancel_subscription" && perYear) {
      const cancelled = action.cancelledOn ? isoDate(action.cancelledOn) : since;
      const history = from(keyOf(evidence.merchant));
      const last = history.filter((t) => t.date <= cancelled).at(-1);
      const after = history.some((t) => t.date > cancelled);
      const due = last ? addDays(last.date, Math.round(365 / perYear)) : null;
      if (last && due && !after && addDays(due, CANCEL_GRACE_DAYS) < asOf) {
        const yearly = num(evidence.annualCostCents) ?? last.amountCents * perYear;
        receipt({
          kind: "cancelled",
          cents: yearly,
          yearly: true,
          seen: view(last),
          proof: `Last charged ${formatCents(last.amountCents)} on ${dayLabel(last.date, { year: true })}; nothing since, though the next one was due ${dayLabel(due, { year: true })}.`,
        });
        continue;
      }
    }

    if (estimate <= 0 && action.confirmedAnnualCents === null && action.refundCents === null) {
      continue;
    }
    (action.savingMissedAt && done ? notShown : estimated).push({
      actionId: action.id,
      title,
      cents: actionWorthCents(action, estimate) ?? 0,
      why:
        action.savingMissedAt && done
          ? "It never showed up in your transactions, so it doesn't count as saved."
          : !done
            ? "Jane is still working on it."
            : action.confirmedAnnualCents !== null
              ? "The company confirmed it. It counts once the lower bill shows up in your transactions."
              : "Done. It counts once your transactions show it.",
    });
  }
  return {
    confirmed,
    confirmedCents: confirmed.reduce((sum, r) => sum + r.cents, 0),
    estimated,
    estimatedCents: estimated.reduce((sum, e) => sum + e.cents, 0),
    notShown,
  };
}

// The whole verified record: what Jane did (provenSavings, from its actions) and what the person
// did on its suggestions (savingsRecord, checked each night), confirmed apart from expected.
// A suggestion confirmed by the same transaction as one of Jane's receipts counts once.
export type VerifiedSavings = {
  actions: ProvenSavings;
  suggestions: SavingsRecord;
  confirmedCents: number;
  expectedCents: number;
};

export async function verifiedSavings(
  userId: string,
  options: Options = {},
): Promise<VerifiedSavings> {
  const [actions, record] = await Promise.all([
    provenSavings(userId, options),
    savingsRecord(userId, { client: options.client }),
  ]);
  const seen = new Set(
    actions.confirmed.map((r) => `${r.seen.date}|${r.seen.description}|${r.seen.amountCents}`),
  );
  const fresh = record.confirmed.filter(
    (o) => !o.evidence.some((t) => seen.has(`${t.date}|${t.description}|${t.amountCents}`)),
  );
  const suggestions: SavingsRecord = {
    ...record,
    confirmed: fresh,
    confirmedCents: fresh.reduce((sum, o) => sum + (o.confirmedCents ?? 0), 0),
  };
  return {
    actions,
    suggestions,
    confirmedCents: actions.confirmedCents + suggestions.confirmedCents,
    expectedCents: actions.estimatedCents + suggestions.expectedCents,
  };
}

// A link to the confirmed total as it is now. Only the total is on the shared page.
export async function shareSavedTotal(
  userId: string,
  options: Options = {},
): Promise<{ token: string; totalCents: number }> {
  const { confirmedCents } = await verifiedSavings(userId, options);
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  await scopedFor(userId, options.client ?? defaultClient).savedShares.create({
    data: { userId, tokenHash: sha256Hex(token), totalCents: confirmedCents },
  });
  await track(userId, "savings_shared", {});
  return { token, totalCents: confirmedCents };
}

// Takes every shared link of the person's down.
export async function revokeSavedShares(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const { count } = await scopedFor(userId, client).savedShares.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: now },
  });
  return count;
}

// For the public page: the total behind a link, or null when it's wrong or taken down.
// A lookup by the token's hash across everyone, by design: the link is the permission.
export async function sharedTotal(
  token: string,
  { client = defaultClient }: Options = {},
): Promise<{ totalCents: number; createdAt: Date } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const share = await client.savedShare.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: { totalCents: true, createdAt: true, revokedAt: true },
  });
  return share && !share.revokedAt
    ? { totalCents: share.totalCents, createdAt: share.createdAt }
    : null;
}
