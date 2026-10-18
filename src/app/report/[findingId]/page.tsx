import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { scopedDb } from "@/lib/db-scoped";
import { UNDO_WINDOW_SECONDS } from "@/lib/decisions";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { DecisionButtons } from "./decision-buttons";
import { savingsLine } from "@/lib/savings-text";

async function Card({ params }: { params: PageProps<"/report/[findingId]">["params"] }) {
  const user = await requireUser();
  const { findingId } = await params;
  const db = await scopedDb();
  const finding = await db.findings.findFirst({
    where: { id: findingId },
    select: { ...CARD_SELECT, status: true },
  });
  if (!finding) notFound();
  if (finding.status === "new") {
    await db.findings.updateMany({
      where: { id: finding.id, status: "new" },
      data: { status: "shown" },
    });
  }
  const card = buildCard(finding);
  const open = finding.status === "new" || finding.status === "shown";

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="card_opened" findingId={finding.id} />
      <Link href="/report" className="text-sm text-zinc-500 hover:underline">
        ‹ Back to your report
      </Link>

      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{card.title}</h1>
          <p className="text-zinc-700 dark:text-zinc-300">{card.explanation}</p>
        </header>

        <section className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            What changes if you say yes
          </h2>
          <p className="mt-1">{card.whatChanges}</p>
          <p className="mt-3 text-lg font-semibold">
            {savingsLine(card.findingType, card.annualSavingsCents)}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            An estimate from your last 12 months, not a promise.
          </p>
        </section>

        {card.findingType === "card_interest" && (
          <Link href="/debt" className="font-medium text-emerald-700 hover:underline">
            See what paying off your cards could look like
          </Link>
        )}

        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">What you give up</h2>
          <p className="text-zinc-700 dark:text-zinc-300">{card.giveUp}</p>
        </section>

        {card.alternatives.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="font-semibold">Other options</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-700 dark:text-zinc-300">
              {card.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </section>
        )}

        {card.evidence.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Why we think so</h2>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {card.evidence.map((row, i) => (
                <li key={i} className="flex justify-between gap-4 px-4 py-2">
                  <span className="min-w-0 break-words">
                    {row.date && <span className="text-zinc-500">{row.date} · </span>}
                    {row.label}
                  </span>
                  {row.amountCents !== null && (
                    <span className="shrink-0 font-medium">{formatCents(row.amountCents)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.referralDisclosure && (
          <p className="text-xs text-zinc-500">{card.referralDisclosure}</p>
        )}

        {open ? (
          <DecisionButtons
            findingId={finding.id}
            cardHash={cardHash(card)}
            undoSeconds={UNDO_WINDOW_SECONDS}
          />
        ) : (
          <p className="rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900">
            You&apos;ve already answered this one.{" "}
            <Link href="/actions" className="font-medium text-emerald-700 hover:underline">
              See your actions
            </Link>
          </p>
        )}
      </article>
    </>
  );
}

export default function CardPage({ params }: PageProps<"/report/[findingId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Card params={params} />
      </Suspense>
    </main>
  );
}
