"use client";

import { useActionState } from "react";
import { invite, join, type HouseholdState } from "./actions";

const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";

function Message({ state }: { state: HouseholdState }) {
  if (!state) return null;
  return (
    <div role={state.ok ? "status" : "alert"} className="flex flex-col gap-1 text-sm">
      <p className={state.ok ? "text-emerald-700" : "text-red-700"}>{state.message}</p>
      {state.link && (
        <input
          readOnly
          value={state.link}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-xs dark:border-zinc-700"
        />
      )}
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState<HouseholdState, FormData>(invite, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your partner&apos;s email
        <input
          name="email"
          type="email"
          required
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Inviting…" : "Invite"}
      </button>
    </form>
  );
}

export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<HouseholdState, FormData>(join, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <Message state={state} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Joining…" : "Join household"}
      </button>
    </form>
  );
}
