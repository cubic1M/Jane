"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveDeadline, type DeadlineState } from "./actions";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

const KINDS = [
  { value: "fsa", label: "FSA deadline" },
  { value: "card_benefit", label: "Card benefit to use" },
  { value: "warranty", label: "Warranty" },
  { value: "other", label: "Something else" },
] as const;

export function DeadlineForm({ today }: { today: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<DeadlineState, FormData>(saveDeadline, null);
  // Show the new deadline in the list without losing the message above.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label htmlFor="deadline-title" className="flex flex-col gap-1 text-sm font-medium">
        What it&apos;s for
        <input
          id="deadline-title"
          name="title"
          required
          maxLength={120}
          placeholder="Use my $200 travel credit"
          className={INPUT}
        />
      </label>
      <label htmlFor="deadline-due" className="flex flex-col gap-1 text-sm font-medium">
        By
        <input id="deadline-due" name="dueOn" type="date" required min={today} className={INPUT} />
      </label>
      <label htmlFor="deadline-kind" className="flex flex-col gap-1 text-sm font-medium">
        Kind
        <select id="deadline-kind" name="kind" defaultValue="other" className={INPUT}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="deadline-note" className="flex flex-col gap-1 text-sm font-medium">
        Note (optional)
        <input id="deadline-note" name="note" maxLength={500} className={INPUT} />
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`sm:col-span-2 ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-end rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add deadline"}
      </button>
    </form>
  );
}
