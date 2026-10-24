import Link from "next/link";
import type { ChecklistItem } from "@/lib/checklist";
import { hideChecklist } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function FirstWeekChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Getting started</h2>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {done} of {items.length} done
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                item.done
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-400 dark:border-zinc-600"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            {item.done ? (
              <span className="text-zinc-600 line-through dark:text-zinc-400">
                {item.label}
                <span className="sr-only"> (done)</span>
              </span>
            ) : (
              <span className="[overflow-wrap:anywhere]">
                <Link href={item.href} className="font-medium text-emerald-700 hover:underline">
                  {item.label}
                </Link>
                {item.progress && <span className="text-sm text-zinc-500"> · {item.progress}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <form action={hideChecklist}>
        <SubmitButton className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Hide this for good
        </SubmitButton>
      </form>
    </section>
  );
}
