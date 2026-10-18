"use client";

import { useActionState } from "react";
import { deleteMyData, disconnectBank, type SettingsState } from "./actions";

const DANGER =
  "inline-flex h-11 items-center justify-center rounded-full border border-red-300 px-5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";

function Message({ state }: { state: SettingsState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

export function DisconnectForm({ itemId, name }: { itemId: string; name: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(disconnectBank, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Disconnect ${name}? We'll delete the transactions we read from it.`))
          e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="itemId" value={itemId} />
      <button type="submit" disabled={pending} className={DANGER}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function DeleteDataForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(deleteMyData, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Type DELETE to confirm
        <input
          name="confirm"
          autoComplete="off"
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
      </label>
      <button type="submit" disabled={pending} className={`${DANGER} self-start`}>
        {pending ? "Deleting…" : "Delete all my data"}
      </button>
      <Message state={state} />
    </form>
  );
}
