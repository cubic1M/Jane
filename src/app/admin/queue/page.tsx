import Link from "next/link";
import { Suspense } from "react";
import { TURNAROUND_BUSINESS_DAYS } from "@/config/concierge";
import type { ActionStatus, ActionType } from "@/generated/prisma/client";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { isOverdue } from "@/lib/business-days";
import { ACTION_STATUSES, listQueue } from "@/lib/concierge";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";

const ACTION_TYPES: ActionType[] = [
  "cancel_subscription",
  "fight_price_increase",
  "recover_bank_fees",
  "move_idle_cash",
  "insurance_reshop",
  "card_interest",
  "review_cash_flow",
];

const label = (value: string) => value.replaceAll("_", " ");

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

async function Queue({
  searchParams,
}: {
  searchParams: PageProps<"/admin/queue">["searchParams"];
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const filter = {
    type: pick(params.type, ACTION_TYPES),
    status: pick<ActionStatus>(params.status, ACTION_STATUSES),
  };
  const actions = await listQueue(admin, filter);
  const now = new Date();

  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Action queue</h1>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Type
          <select
            name="type"
            defaultValue={filter.type ?? ""}
            className="h-10 rounded-lg border border-zinc-300 bg-transparent px-2 dark:border-zinc-700"
          >
            <option value="">All types</option>
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={filter.status ?? ""}
            className="h-10 rounded-lg border border-zinc-300 bg-transparent px-2 dark:border-zinc-700"
          >
            <option value="">Open</option>
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACTION_STATUS_LABELS[s].label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-full border border-zinc-300 px-4 font-semibold dark:border-zinc-700"
        >
          Filter
        </button>
      </form>

      {actions.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((action) => {
            const late =
              action.status === "queued" &&
              isOverdue(action.createdAt, TURNAROUND_BUSINESS_DAYS, now);
            return (
              <li key={action.id}>
                <Link
                  href={`/admin/actions/${action.id}`}
                  className={`flex flex-col gap-1 rounded-xl border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                    late
                      ? "border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <span className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">{action.title}</span>
                    <span className="text-sm">{ACTION_STATUS_LABELS[action.status].label}</span>
                  </span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {label(action.type)} · {action.user.email} · queued{" "}
                    {action.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    {action.assignee ? ` · ${action.assignee}` : ""}
                    {late ? " · over one business day" : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function QueuePage({ searchParams }: PageProps<"/admin/queue">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
