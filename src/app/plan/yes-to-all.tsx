"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { answerAll } from "./actions";

export type WeekItem = {
  findingId: string;
  cardHash: string;
  title: string;
  savings: string;
  preselected: boolean;
};

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
    >
      {pending ? "Starting…" : count === 0 ? "Nothing ticked" : `Go ahead with ${count}`}
    </button>
  );
}

// The week in one tap (spec step 59): what Jane would do, already ticked. The person
// unticks anything they don't want; unticked items stay on the plan.
export function YesToAll({ items }: { items: WeekItem[] }) {
  const [ticked, setTicked] = useState(
    () => new Set(items.filter((i) => i.preselected).map((i) => i.findingId)),
  );
  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <form
      action={answerAll}
      className="flex flex-col gap-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900"
    >
      <h2 className="font-semibold">This week, Jane will</h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.findingId}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="item"
                value={`${i.findingId}:${i.cardHash}`}
                checked={ticked.has(i.findingId)}
                onChange={() => toggle(i.findingId)}
                className="mt-1 size-5 shrink-0"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium [overflow-wrap:anywhere]">{i.title}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{i.savings}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Untick anything you don&apos;t want. Each item&apos;s details, and No or Change, are below.
      </p>
      <Submit count={ticked.size} />
    </form>
  );
}
