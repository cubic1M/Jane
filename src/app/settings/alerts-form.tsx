"use client";

import { useActionState } from "react";
import type { AlertDelivery } from "@/config/alerts";
import { saveAlertPreferences, type SettingsState } from "./actions";

const CHOICES: Record<AlertDelivery, string> = {
  email: "Email me right away",
  app: "Show in the app and weekly email",
  off: "Off",
};

export type AlertRow = {
  type: string;
  label: string;
  description: string;
  urgent: boolean;
  value: AlertDelivery;
};

export function AlertsForm({ rows }: { rows: AlertRow[] }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveAlertPreferences,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.type} className="flex flex-col gap-1">
            <label htmlFor={`alert-${row.type}`} className="font-medium">
              {row.label}
            </label>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{row.description}</p>
            <select
              id={`alert-${row.type}`}
              name={row.type}
              defaultValue={row.value}
              className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base sm:max-w-xs dark:border-zinc-700"
            >
              {(Object.keys(CHOICES) as AlertDelivery[])
                .filter((choice) => row.urgent || choice !== "email")
                .map((choice) => (
                  <option key={choice} value={choice}>
                    {CHOICES[choice]}
                  </option>
                ))}
            </select>
          </li>
        ))}
      </ul>
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
        {pending ? "Saving…" : "Save alert settings"}
      </button>
    </form>
  );
}
