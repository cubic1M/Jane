"use client";

import { useActionState } from "react";
import { saveRental, type RentalState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const FIELDS: [string, string, string?][] = [
  ["name", "Name (like “Maple St rental”)"],
  ["purchase", "Price you paid ($)"],
  ["month", "Month first rented (1 to 12)"],
  ["year", "Year first rented"],
  ["cashInvested", "Cash you put in ($)"],
  ["loanBalance", "Loan balance now ($)"],
  ["loanRate", "Loan rate (%)"],
  ["monthlyPayment", "Loan payment a month ($)"],
  ["rentMatch", "Text on rent deposits (like TENANT RENT)"],
  ["mortgageMatch", "Text on the loan payment"],
  ["taxMatch", "Text on property tax payments"],
  ["expenseMatch", "Text on repairs and insurance, comma-separated"],
];

export function RentalForm() {
  const [state, action, pending] = useActionState<RentalState, FormData>(saveRental, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(([id, label]) => (
        <label
          key={id}
          htmlFor={`rental-${id}`}
          className="flex flex-col gap-1 text-sm font-medium"
        >
          {label}
          <input id={`rental-${id}`} name={id} className={INPUT} />
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
        Add the rental
      </button>
    </form>
  );
}
