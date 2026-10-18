import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { scopedDb } from "@/lib/db-scoped";
import { membershipPriceCents, stripeEnabled } from "@/lib/membership/offer";
import { markOfferShown, offerFor, savedToDate } from "@/lib/membership/service";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { MembershipOffer } from "./membership-offer";
import { savingsLine } from "@/lib/savings-text";
import type { FindingType } from "@/generated/prisma/client";

// The card text saved with the decision: what the person agreed to.
function agreedTo(snapshot: unknown) {
  const card = (snapshot ?? {}) as {
    title?: unknown;
    annualSavingsCents?: unknown;
    findingType?: unknown;
  };
  return {
    title: typeof card.title === "string" ? card.title : "Your request",
    annualSavingsCents:
      typeof card.annualSavingsCents === "number" ? card.annualSavingsCents : null,
    findingType: (typeof card.findingType === "string"
      ? card.findingType
      : "subscription_review") as FindingType,
  };
}

const STATUS_STYLES: Record<keyof typeof ACTION_STATUS_LABELS, string> = {
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  waiting_on_user: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

async function ActionsContent({
  searchParams,
}: {
  searchParams: PageProps<"/actions">["searchParams"];
}) {
  const user = await requireUser();
  const db = await scopedDb();
  const { membership } = await searchParams;
  const [offer, saved] = await Promise.all([offerFor(user.id), savedToDate(user.id)]);
  await markOfferShown(user.id, offer, saved);
  const actions = await db.actions.findMany({
    select: {
      id: true,
      status: true,
      userTodo: true,
      createdAt: true,
      decision: { select: { cardSnapshot: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const diy = await db.decisions.findMany({
    where: { choice: "diy", undoneAt: null },
    select: { id: true, findingId: true, diyDoneAt: true, cardSnapshot: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your actions</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Everything you said yes to, and where it stands.
        </p>
      </div>

      {membership === "paid" && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          Thank you for becoming a founding member. We&apos;ll be in touch soon.
        </p>
      )}
      {offer.show && (
        <MembershipOffer
          savedLabel={saved > 0 ? formatCents(saved) : null}
          priceLabel={stripeEnabled() ? formatCents(membershipPriceCents()) : null}
        />
      )}
      {!offer.show && offer.member && membership !== "paid" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {offer.member === "paid"
            ? "You're a founding member. Thank you."
            : "Your membership spot is reserved. We'll let you know when it opens."}
        </p>
      )}

      {diy.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Doing it yourself</h2>
          <ul className="flex flex-col gap-3">
            {diy.map((d) => {
              const card = agreedTo(d.cardSnapshot);
              return (
                <li key={d.id}>
                  <Link
                    href={`/report/${d.findingId}`}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <span className="font-semibold">{card.title}</span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${d.diyDoneAt ? STATUS_STYLES.done : STATUS_STYLES.waiting_on_user}`}
                    >
                      {d.diyDoneAt ? "Done" : "Your steps"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {actions.length === 0 && diy.length > 0 ? null : actions.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing yet.{" "}
          <Link href="/report" className="font-medium text-emerald-700 hover:underline">
            Open your report
          </Link>{" "}
          and say yes to anything you want us to handle.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action) => {
            const card = agreedTo(action.decision.cardSnapshot);
            const status = ACTION_STATUS_LABELS[action.status];
            return (
              <li
                key={action.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-semibold">{card.title}</h2>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[action.status]}`}
                  >
                    {status.label}
                  </span>
                </div>
                {card.annualSavingsCents !== null && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {savingsLine(card.findingType, card.annualSavingsCents)}
                  </p>
                )}
                {action.status === "waiting_on_user" && action.userTodo ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
                    <strong>What we need from you:</strong> {action.userTodo}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{status.detail}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function ActionsPage({ searchParams }: PageProps<"/actions">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ActionsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
