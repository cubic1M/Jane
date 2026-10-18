import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// The card text saved with the decision: what the person agreed to.
function agreedTo(snapshot: unknown): { title: string; annualSavingsCents: number | null } {
  const card = (snapshot ?? {}) as { title?: unknown; annualSavingsCents?: unknown };
  return {
    title: typeof card.title === "string" ? card.title : "Your request",
    annualSavingsCents:
      typeof card.annualSavingsCents === "number" ? card.annualSavingsCents : null,
  };
}

const STATUS_STYLES: Record<keyof typeof ACTION_STATUS_LABELS, string> = {
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  waiting_on_user: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

async function ActionsContent() {
  const user = await requireUser();
  const db = await scopedDb();
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

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your actions</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Everything you said yes to, and where it stands.
        </p>
      </div>

      {actions.length === 0 ? (
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
                    Could save about {formatCents(card.annualSavingsCents)} a year
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

export default function ActionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ActionsContent />
      </Suspense>
    </main>
  );
}
