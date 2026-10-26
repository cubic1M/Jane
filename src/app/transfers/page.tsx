import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { listTransfers } from "@/lib/money-movement/transfers";
import { requireUser } from "@/lib/session";
import { STAND_IN_NOTE } from "@/lib/jane-agent/replies-paycheck";
import { undoTransfer } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Transfers (spec steps 144–145): every transfer and payment Jane scheduled, on its own or on
// a tap, and Undo while it's pending.

const STATUS: Record<string, string> = {
  pending: "Pending",
  completed: "Went through",
  cancelled: "Undone",
  failed: "Didn't go through",
};

async function TransfersContent() {
  const user = await requireUser();
  await connection();
  const [transfers, partner] = await Promise.all([
    listTransfers(user.id),
    moneyPartnerFor(user.id),
  ]);
  return (
    <>
      <AppHeader user={user} />
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Transfers</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Money Jane moved between your accounts or paid, and when. Anything pending can be undone
          until its day.
        </p>
        {partner?.simulated && (
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {STAND_IN_NOTE}
          </p>
        )}
        {!partner && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Moving money needs a money-movement partner, and none is connected for your accounts
            yet. Nothing here moves by itself.
          </p>
        )}
      </section>
      {transfers.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No transfers yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {transfers.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-3 [overflow-wrap:anywhere] dark:border-zinc-800"
            >
              <span className="flex flex-col">
                <span className="font-semibold">
                  {formatCents(t.amountCents)} to {t.toName}
                </span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {STATUS[t.status] ?? t.status} · {t.runOn} ·{" "}
                  {t.by === "autopilot" ? "by Jane (autopilot)" : "on your tap"}
                </span>
              </span>
              {t.undoable && (
                <form action={undoTransfer}>
                  <input type="hidden" name="transferId" value={t.id} />
                  <SubmitButton className="min-h-11 px-3 text-sm font-semibold text-emerald-700 hover:underline">
                    Undo
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function TransfersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Suspense>
        <TransfersContent />
      </Suspense>
    </main>
  );
}
