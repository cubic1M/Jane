import { actionWorthCents } from "@/lib/saved-amount";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { membershipOffer, type Offer } from "./offer";

// Reads and records the membership offer for one person.

type Options = { client?: PrismaClient; now?: Date };

export async function offerFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Offer> {
  const db = scopedFor(userId, client);
  const [finished, intents, user] = await Promise.all([
    db.actions.count({ where: { status: "done" } }),
    db.membershipIntents.findMany({ select: { kind: true } }),
    client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { membershipOfferShownAt: true, membershipOfferDismissedAt: true },
    }),
  ]);
  return membershipOffer(
    {
      hasFinishedAction: finished > 0,
      intents,
      dismissedAt: user.membershipOfferDismissedAt,
      shownAt: user.membershipOfferShownAt,
    },
    now,
  );
}

// Called when the offer is on screen; counts it once per snooze period.
export async function markOfferShown(
  userId: string,
  offer: Offer,
  savedToDateCents: number,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!offer.show || !offer.countAsShown) return;
  await client.user.update({ where: { id: userId }, data: { membershipOfferShownAt: now } });
  await track(userId, "membership_offer_shown", { saved_to_date_cents: savedToDateCents });
}

export async function dismissOffer(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  await client.user.update({ where: { id: userId }, data: { membershipOfferDismissedAt: now } });
}

export async function reserveMembership(userId: string, { client = defaultClient }: Options = {}) {
  const db = scopedFor(userId, client);
  if ((await db.membershipIntents.count()) > 0) return;
  await db.membershipIntents.create({ data: { userId, kind: "reserve" } });
  await track(userId, "membership_reserved", {});
}

// From Stripe's checkout.session.completed webhook. Safe to receive twice: the Stripe
// session id is unique.
export async function recordPaidMembership(
  session: { id: string; userId: string; amountCents: number | null },
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const user = await client.user.findUnique({
    where: { id: session.userId },
    select: { id: true },
  });
  if (!user) return false;
  const { count } = await scopedFor(user.id, client).membershipIntents.createMany({
    data: [
      {
        userId: user.id,
        kind: "paid",
        stripeSessionId: session.id,
        amountCents: session.amountCents,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) return true;
  await logAudit(
    { type: "system", id: null },
    "membership_paid",
    { type: "user", id: user.id },
    {
      stripe_session_id: session.id,
      amount_cents: session.amountCents,
    },
  );
  await track(user.id, "membership_paid", { amount_cents: session.amountCents });
  return true;
}

// What each saving was, for the home hub's Saved tile (founder: "click on it, it expands and
// shows a summary of where was saved"): one line per finished change, biggest first, with what
// kind of saving it was. The same changes and amounts savedToDate adds up, so the tile's lines
// and its total never disagree.
export type SavedKind = "refund" | "cancelled" | "cheaper" | "interest" | "done_yourself";
export type SavedItem = { title: string; kind: SavedKind; cents: number; yearly: boolean };

const KIND_OF: Record<string, SavedKind> = {
  cancel_subscription: "cancelled",
  fight_price_increase: "cheaper",
  negotiate_bill: "cheaper",
  insurance_reshop: "cheaper",
  card_interest: "cheaper",
  move_idle_cash: "interest",
  recover_bank_fees: "refund",
  request_refund: "refund",
  review_cash_flow: "cheaper",
};

type Card = { title?: unknown; annualSavingsCents?: unknown; actionType?: unknown } | null;
const estimateOf = (snapshot: unknown) => {
  const cents = (snapshot as Card)?.annualSavingsCents;
  return typeof cents === "number" ? cents : 0;
};
const titleOf = (snapshot: unknown) => {
  const title = (snapshot as Card)?.title;
  return typeof title === "string" && title ? title : "A change Jane made";
};

// Savings from finished changes: actions the team finished, and do-it-yourself changes the
// person marked done. A finding has one live decision, so nothing counts twice. With
// `between`, only changes finished in that time (the year in review uses it).
export async function savedItems(
  userId: string,
  { client = defaultClient, between }: Options & { between?: { from: Date; to: Date } } = {},
): Promise<SavedItem[]> {
  const db = scopedFor(userId, client);
  const finished = between ? { gte: between.from, lt: between.to } : undefined;
  const [done, diy, acted] = await Promise.all([
    db.actions.findMany({
      where: {
        status: "done",
        // Spec step 207: a saving that never showed up in the transactions doesn't count.
        savingMissedAt: null,
        ...(finished ? { completedAt: finished } : {}),
      },
      select: {
        type: true,
        refundCents: true,
        confirmedAnnualCents: true,
        decision: { select: { cardSnapshot: true } },
      },
    }),
    db.decisions.findMany({
      where: {
        choice: "diy",
        diyDoneAt: finished ?? { not: null },
        undoneAt: null,
      },
      select: { cardSnapshot: true },
    }),
    // Suggestions the person acted on (the verified savings record): what the transactions
    // confirmed, else what was expected. Not one whose saving never showed up.
    db.suggestionOutcomes.findMany({
      where: {
        status: { in: ["open", "unverifiable", "confirmed", "partial"] },
        // A do-it-yourself finding card is already counted above (its decision).
        NOT: { suggestionKey: { startsWith: "finding:" } },
        ...(finished ? { OR: [{ doneAt: finished }, { doneAt: null, answeredAt: finished }] } : {}),
      },
      select: { title: true, expectedCents: true, confirmedCents: true, yearly: true },
    }),
  ]);
  // A refund seen in the transactions, or a lower price confirmed on a call, counts for
  // what actually happened; otherwise the card's estimate, a year of it.
  const items: SavedItem[] = [
    ...done.map((a) => ({
      title: titleOf(a.decision.cardSnapshot),
      kind: a.refundCents !== null ? ("refund" as const) : (KIND_OF[a.type] ?? "cheaper"),
      cents: actionWorthCents(a, estimateOf(a.decision.cardSnapshot)) ?? 0,
      yearly: a.refundCents === null,
    })),
    ...diy.map((d) => ({
      title: titleOf(d.cardSnapshot),
      kind: "done_yourself" as const,
      cents: estimateOf(d.cardSnapshot),
      yearly: true,
    })),
    ...acted.map((o) => ({
      title: o.title,
      kind: "done_yourself" as const,
      cents: o.confirmedCents ?? o.expectedCents,
      yearly: o.yearly,
    })),
  ];
  return items.filter((i) => i.cents > 0).sort((a, b) => b.cents - a.cents);
}

// Yearly savings from finished actions, from the cards people approved: the items above, added.
export async function savedToDate(
  userId: string,
  options: Options & { between?: { from: Date; to: Date } } = {},
): Promise<number> {
  return (await savedItems(userId, options)).reduce((sum, i) => sum + i.cents, 0);
}
