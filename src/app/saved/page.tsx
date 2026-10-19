import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { provenSavings, type Receipt } from "@/lib/savings-proof";
import { requireUser } from "@/lib/session";
import { ShareForm } from "./share-form";

// What Jane saved you (spec step 139): what the person's own transactions prove, each with
// its receipt, and apart from it what's still an estimate.

const KIND_LABEL: Record<Receipt["kind"], string> = {
  refund: "Refund",
  lower_bill: "Lower bill",
  switched: "Switched",
  cancelled: "Cancelled",
};

async function SavedContent() {
  const user = await requireUser();
  await connection();
  const saved = await provenSavings(user.id);
  return (
    <>
      <AppHeader user={user} />
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What Jane saved you</h1>
        <p className="text-4xl font-semibold text-emerald-700">
          {formatCents(saved.confirmedCents)}
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          Confirmed in your own transactions: refunds that came back, and a year of each lower bill
          and cancelled charge.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Receipts</h2>
        {saved.confirmed.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nothing confirmed yet. When a refund comes back or a bill goes down, it shows here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {saved.confirmed.map((r) => (
              <li
                key={r.actionId}
                className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
              >
                <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  {KIND_LABEL[r.kind]}
                </span>
                <span className="font-semibold">
                  {r.title}: {formatCents(r.cents)}
                  {r.yearly ? " a year" : ""}
                </span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{r.proof}</span>
                <span className="text-xs text-zinc-500">
                  Seen: {r.seen.date} · {r.seen.description} ·{" "}
                  {formatCents(Math.abs(r.seen.amountCents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Still estimates</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          About {formatCents(saved.estimatedCents)} a year more, not counted until your transactions
          show it.
        </p>
        {saved.estimated.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {saved.estimated.map((e) => (
              <li key={e.actionId}>
                <span className="font-medium">{e.title}</span>: about {formatCents(e.cents)}.{" "}
                <span className="text-zinc-600 dark:text-zinc-400">{e.why}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Share it</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A link to a page with your confirmed total and nothing else: no name, no accounts, no
          details.
        </p>
        <ShareForm />
      </section>
    </>
  );
}

export default function SavedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <Suspense>
        <SavedContent />
      </Suspense>
    </main>
  );
}
