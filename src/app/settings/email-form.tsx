"use client";

import { useActionState } from "react";
import { saveEmailPreferences, type SettingsState } from "./actions";

export function EmailForm({
  digestEnabled,
  timezone,
  timezones,
}: {
  digestEnabled: boolean;
  timezone: string;
  timezones: readonly { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveEmailPreferences,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-center gap-3">
        <input type="checkbox" name="digest" defaultChecked={digestEnabled} className="h-5 w-5" />
        Send me a weekly email on Monday with what we saved and what needs me, and the monthly money
        report
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your timezone
        <select
          name="timezone"
          defaultValue={timezone}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        >
          {timezones.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-emerald-700" : "text-red-700"}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
