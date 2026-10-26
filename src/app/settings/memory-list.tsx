import type { Preference } from "@/lib/jane-agent/preferences";
import { forgetPreference } from "./memory-actions";
import { SubmitButton } from "@/components/submit-button";

// What Jane remembers (spec step 91): each thing the person told it or asked it not to
// suggest, with "Forget" next to it.
export function MemoryList({ preferences }: { preferences: Preference[] }) {
  if (preferences.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Nothing yet. Tell Jane things like &quot;payday is the 15th&quot; or &quot;I need my
        car&quot; in the chat, and tap Remember this.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {preferences.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 [overflow-wrap:anywhere]">{p.label}</span>
          <form action={forgetPreference}>
            <input type="hidden" name="preferenceId" value={p.id} />
            <SubmitButton className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-emerald-700 hover:underline">
              Forget<span className="sr-only">: {p.label}</span>
            </SubmitButton>
          </form>
        </li>
      ))}
    </ul>
  );
}
