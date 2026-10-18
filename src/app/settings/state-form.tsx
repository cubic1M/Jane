"use client";

import { useActionState } from "react";
import { saveState, type SettingsState } from "./actions";

export function StateForm({
  state,
  states,
}: {
  state: string | null;
  states: readonly { code: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<SettingsState, FormData>(saveState, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your state
        <select
          name="state"
          defaultValue={state ?? ""}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        >
          <option value="">Not set</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Save
      </button>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-emerald-700" : "text-red-700"}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
