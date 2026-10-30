"use client";

import { useActionState } from "react";
import { addProduct, type ProductState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const FIELDS: [string, string][] = [
  ["name", "Name on the statement"],
  ["provider", "Company"],
  ["value", "Value or cash value now ($)"],
  ["feePercent", "Total yearly cost (%) — annuities"],
  ["premiumYearly", "Premium a year ($) — whole life"],
  ["purchasedYear", "Year you bought it"],
  ["purchasedMonth", "Month you bought it (1 to 12)"],
  ["schedule", "Surrender charges by year, like 7,6,5,4,3,2,1"],
];

export function ProductForm() {
  const [state, action, pending] = useActionState<ProductState, FormData>(addProduct, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label htmlFor="product-kind" className="flex flex-col gap-1 text-sm font-medium">
        Kind
        <select id="product-kind" name="kind" className={INPUT} defaultValue="annuity">
          <option value="annuity">Variable annuity</option>
          <option value="whole_life">Whole life insurance</option>
        </select>
      </label>
      {FIELDS.map(([id, label]) => (
        <label
          key={id}
          htmlFor={`product-${id}`}
          className="flex flex-col gap-1 text-sm font-medium"
        >
          {label}
          <input id={`product-${id}`} name={id} className={INPUT} />
        </label>
      ))}
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
        Save
      </button>
    </form>
  );
}
