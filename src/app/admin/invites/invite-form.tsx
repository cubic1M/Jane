"use client";

import { useActionState } from "react";
import { createInvite, type InviteState } from "./actions";

const FIELD = "h-10 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvite, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Uses
        <input name="maxUses" type="number" min={1} defaultValue={1} className={`${FIELD} w-24`} />
      </label>
      <label className="flex flex-col gap-1">
        Expires in days (blank for never)
        <input name="expiresInDays" type="number" min={1} className={`${FIELD} w-28`} />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        Note
        <input name="note" placeholder="Who it's for" className={FIELD} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Create code
      </button>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`w-full ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
