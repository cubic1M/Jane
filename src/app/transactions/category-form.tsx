"use client";

import { useActionState } from "react";
import { saveCategory, type CategoryState } from "./actions";

export type CategoryGroup = { label: string; options: { value: string; label: string }[] };

export function CategoryForm({
  transactionId,
  current,
  groups,
}: {
  transactionId: string;
  current: string | null;
  groups: CategoryGroup[];
}) {
  const [state, action, pending] = useActionState<CategoryState, FormData>(saveCategory, null);
  return (
    <form action={action} className="flex flex-col gap-2 pt-2">
      <input type="hidden" name="transactionId" value={transactionId} />
      <label className="flex flex-col gap-1 text-xs font-medium">
        Category
        <select
          name="category"
          defaultValue={current ?? ""}
          className="h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
        >
          <option value="" disabled>
            Pick a category
          </option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="forMerchant" className="h-4 w-4" />
        Always use this for this merchant
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center self-start rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save category"}
      </button>
    </form>
  );
}
