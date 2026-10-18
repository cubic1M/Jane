"use client";

import { useActionState, useState } from "react";
import type { ActionStatus } from "@/generated/prisma/client";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { updateAction, type FormState } from "./actions";

const FIELD =
  "rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";
const STATUSES: ActionStatus[] = ["queued", "in_progress", "waiting_on_user", "done", "failed"];

export function StatusForm({
  actionId,
  status,
  assignee,
  notes,
  userTodo,
  team,
  replies,
}: {
  actionId: string;
  status: ActionStatus;
  assignee: string | null;
  notes: string | null;
  userTodo: string | null;
  team: string[];
  replies: { id: string; title: string; body: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAction, null);
  const [todo, setTodo] = useState(userTodo ?? "");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="actionId" value={actionId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Status
        <select name="status" defaultValue={status} className={FIELD}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACTION_STATUS_LABELS[s].label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Assignee
        <select name="assignee" defaultValue={assignee ?? ""} className={FIELD}>
          <option value="">Unassigned</option>
          {/* Someone no longer on the team stays visible until reassigned. */}
          {[...new Set([...team, ...(assignee ? [assignee] : [])])].map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
      </label>
      {replies.length > 0 && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Insert a saved reply
          <select
            value=""
            onChange={(e) => {
              const reply = replies.find((r) => r.id === e.target.value);
              if (reply) setTodo(reply.body);
            }}
            className={FIELD}
          >
            <option value="">Pick one…</option>
            {replies.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        What the person needs to do (required for Waiting on you; shown to them)
        <textarea
          name="userTodo"
          value={todo}
          onChange={(e) => setTodo(e.target.value)}
          rows={3}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Minutes spent (required to close as Done or Couldn&apos;t complete)
        <input name="minutesSpent" type="number" min={1} inputMode="numeric" className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Why it failed (required for Couldn&apos;t complete; team only)
        <textarea name="failureReason" rows={2} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Notes (team only)
        <textarea name="notes" defaultValue={notes ?? ""} rows={3} className={FIELD} />
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-emerald-700" : "text-red-700 dark:text-red-400"}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
