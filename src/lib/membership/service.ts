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

// Yearly savings from finished actions, from the cards people approved.
// Savings from finished changes: actions the team finished, and do-it-yourself changes the
// person marked done. A finding has one live decision, so nothing counts twice. With
// `between`, only changes finished in that time (the year in review uses it).
export async function savedToDate(
  userId: string,
  { client = defaultClient, between }: Options & { between?: { from: Date; to: Date } } = {},
) {
  const db = scopedFor(userId, client);
  const finished = between ? { gte: between.from, lt: between.to } : undefined;
  const [done, diy] = await Promise.all([
    db.actions.findMany({
      where: { status: "done", ...(finished ? { completedAt: finished } : {}) },
      select: { decision: { select: { cardSnapshot: true } } },
    }),
    db.decisions.findMany({
      where: {
        choice: "diy",
        diyDoneAt: finished ?? { not: null },
        undoneAt: null,
      },
      select: { cardSnapshot: true },
    }),
  ]);
  return [...done.map((a) => a.decision), ...diy].reduce((sum, d) => {
    const cents = (d.cardSnapshot as { annualSavingsCents?: unknown } | null)?.annualSavingsCents;
    return sum + (typeof cents === "number" ? cents : 0);
  }, 0);
}
