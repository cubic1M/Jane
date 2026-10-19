"use client";

import { useActionState } from "react";
import { GRANT_KINDS } from "@/config/company-stock";
import { addGrant, type GrantState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export function GrantForm({ company }: { company: string | null }) {
  const [state, action, pending] = useActionState<GrantState, FormData>(addGrant, null);
  const field = (id: string, label: string, props: Record<string, unknown> = {}) => (
    <label htmlFor={`grant-${id}`} className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input id={`grant-${id}`} name={id} className={INPUT} {...props} />
    </label>
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {field("company", "Company", { defaultValue: company ?? "" })}
      {field("ticker", "Ticker (if you know it)")}
      <label htmlFor="grant-kind" className="flex flex-col gap-1 text-sm font-medium">
        Kind
        <select id="grant-kind" name="kind" className={INPUT} defaultValue="rsu">
          {Object.entries(GRANT_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {field("unvestedShares", "Shares still to vest", { inputMode: "decimal", defaultValue: "0" })}
      {field("sharesPerVest", "Shares each time they vest", { inputMode: "decimal" })}
      {field("everyMonths", "Every how many months", { inputMode: "numeric" })}
      {field("nextVestOn", "Next vest date", { type: "date" })}
      {state && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Save the grant
      </button>
    </form>
  );
}
