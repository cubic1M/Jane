"use client";

import { useActionState } from "react";
import { AUTOPILOT_LEVELS, AUTOPILOT_ORDER, AUTOPILOT_RECOMMENDED } from "@/config/autopilot";
import { chooseAutopilot, type AutopilotState } from "@/app/settings/autopilot-actions";

// How much Jane does on its own: one tap, the recommended choice first.
export function AutopilotChooser({ compact = false }: { compact?: boolean }) {
  const [state, action, pending] = useActionState<AutopilotState, FormData>(chooseAutopilot, null);
  if (state?.ok) {
    return (
      <p role="status" className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
        {state.message}
      </p>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">How much should Jane do on its own?</h2>
        {!compact && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick once; change it any time in Settings. Moving money, phone calls, cancelling and
            insurance always need your yes.
          </p>
        )}
      </div>
      <form action={action} className="flex flex-col gap-2">
        {AUTOPILOT_ORDER.map((level) => (
          <button
            key={level}
            type="submit"
            name="level"
            value={level}
            disabled={pending}
            className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left disabled:opacity-50 ${
              level === AUTOPILOT_RECOMMENDED
                ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="font-semibold">
              {AUTOPILOT_LEVELS[level].label}
              {level === AUTOPILOT_RECOMMENDED ? " (recommended)" : ""}
            </span>
            {!compact && <span className="text-sm">{AUTOPILOT_LEVELS[level].description}</span>}
          </button>
        ))}
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </section>
  );
}
