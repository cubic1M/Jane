"use client";

import { useActionState } from "react";
import { DEFAULT_LINK_DAYS, LINK_DAYS_CHOICES } from "@/config/accountant";
import { accountantAction, type AccountantState } from "./actions";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";

function Status({ state }: { state: AccountantState }) {
  return (
    <div role="status" className={state ? "flex flex-col gap-2" : "sr-only"}>
      <p className={state?.ok ? "text-sm text-emerald-800" : "text-sm text-red-700"}>
        {state?.message ?? ""}
      </p>
      {state?.url && (
        <input
          readOnly
          aria-label="Your link"
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${INPUT} w-full font-mono text-sm`}
        />
      )}
    </div>
  );
}

export function CreateForm() {
  const [state, action, pending] = useActionState<AccountantState, FormData>(
    accountantAction,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="create" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Who is it for?</span>
          <input name="label" placeholder="Dana at Hill & Co" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">It works for</span>
          <select name="days" defaultValue={DEFAULT_LINK_DAYS} className={INPUT}>
            {LINK_DAYS_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={pending} className={BUTTON}>
        Make a link
      </button>
      <Status state={state} />
    </form>
  );
}

export function RevokeButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<AccountantState, FormData>(
    accountantAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="intent" value="revoke" />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Revoke the link for ${label}`}
        className="text-sm font-medium text-emerald-700 underline"
      >
        Revoke
      </button>
      <Status state={state} />
    </form>
  );
}

export function SeenButton() {
  const [state, action, pending] = useActionState<AccountantState, FormData>(
    accountantAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="intent" value="seen" />
      <button type="submit" disabled={pending} className={BUTTON}>
        Mark as read
      </button>
      <Status state={state} />
    </form>
  );
}
