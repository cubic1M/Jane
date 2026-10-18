"use client";

import { useActionState } from "react";
import { ASSET_KINDS } from "@/config/net-worth";
import { saveAsset, type AssetState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export type AssetFormValues = {
  assetId: string;
  kind: string;
  name: string;
  value: string;
  valuedOn: string;
  loanAccountId: string;
};

export function AssetForm({
  values,
  loans,
  today,
}: {
  values: AssetFormValues;
  loans: { id: string; name: string; label: string }[];
  // YYYY-MM-DD: the latest date the value can be from.
  today: string;
}) {
  const [state, action, pending] = useActionState<AssetState, FormData>(saveAsset, null);
  // After a problem, the form shows what they typed rather than resetting.
  const shown = state ? { ...values, ...state.input } : values;
  const id = (name: string) => `${values.assetId || "new"}-${name}`;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="assetId" value={values.assetId} />
      <label htmlFor={id("kind")} className="flex flex-col gap-1 text-sm font-medium">
        What it is
        <select id={id("kind")} name="kind" defaultValue={shown.kind} className={INPUT}>
          {Object.entries(ASSET_KINDS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("name")} className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input
          id={id("name")}
          name="name"
          defaultValue={shown.name}
          placeholder="Our house"
          className={INPUT}
        />
      </label>
      <label htmlFor={id("value")} className="flex flex-col gap-1 text-sm font-medium">
        What it&apos;s worth ($)
        <input
          id={id("value")}
          name="value"
          inputMode="decimal"
          defaultValue={shown.value}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("valuedOn")} className="flex flex-col gap-1 text-sm font-medium">
        Value as of
        <input
          id={id("valuedOn")}
          name="valuedOn"
          type="date"
          max={today}
          defaultValue={shown.valuedOn || today}
          className={INPUT}
        />
      </label>
      <label
        htmlFor={id("loanAccountId")}
        className="flex flex-col gap-1 text-sm font-medium sm:col-span-2"
      >
        Loan against it
        <select
          id={id("loanAccountId")}
          name="loanAccountId"
          defaultValue={shown.loanAccountId}
          className={INPUT}
        >
          <option value="">No loan</option>
          {loans.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.label})
            </option>
          ))}
        </select>
      </label>
      {state && (
        <p role="alert" className="text-red-700 sm:col-span-2 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-end rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : values.assetId ? "Save" : "Add it"}
      </button>
    </form>
  );
}
