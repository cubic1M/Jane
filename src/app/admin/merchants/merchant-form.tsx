"use client";

import { useActionState } from "react";
import { saveMerchant, type MerchantState } from "./actions";

export type MerchantFormValues = {
  id: string;
  name: string;
  key: string;
  aliases: string;
  category: string;
  cancelUrl: string;
  supportUrl: string;
  supportPhone: string;
  typicalMonthly: string;
  reviewed: boolean;
};

const INPUT =
  "h-10 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700";

export function MerchantForm({
  values,
  categories,
}: {
  values: MerchantFormValues;
  categories: readonly string[];
}) {
  const [state, action, pending] = useActionState<MerchantState, FormData>(saveMerchant, null);
  const prefix = values.id || "new";
  const text = (name: keyof MerchantFormValues, label: string, hint?: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium" htmlFor={`${prefix}-${name}`}>
      {label}
      <input
        id={`${prefix}-${name}`}
        name={name}
        defaultValue={String(values[name])}
        className={INPUT}
      />
      {hint && <span className="font-normal text-zinc-500">{hint}</span>}
    </label>
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={values.id} />
      {text("name", "Name")}
      {text("key", "Key", "Lower case, as it appears after cleanup; leave empty to use the name.")}
      {text("aliases", "Other statement names", "Comma separated.")}
      <label className="flex flex-col gap-1 text-xs font-medium" htmlFor={`${prefix}-category`}>
        Category
        <select
          id={`${prefix}-category`}
          name="category"
          defaultValue={values.category}
          className={INPUT}
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {text("cancelUrl", "Cancel link")}
      {text("supportUrl", "Support link")}
      {text("supportPhone", "Support phone")}
      {text("typicalMonthly", "Typical price a month ($)")}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="reviewed"
          defaultChecked={values.reviewed}
          className="h-4 w-4"
        />
        I checked these details today
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm sm:col-span-2 ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : values.id ? "Save" : "Add merchant"}
      </button>
    </form>
  );
}
