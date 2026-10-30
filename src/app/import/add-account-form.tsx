"use client";

import { useActionState } from "react";
import { createCsvAccount } from "./actions";

const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base focus-visible:outline-2 focus-visible:outline-emerald-700 dark:border-zinc-700";

export function AddAccountForm() {
  const [state, action, pending] = useActionState(createCsvAccount, null);

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h3 className="font-semibold">Add an account</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            name="name"
            required
            maxLength={60}
            placeholder="Chase checking"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Type
          <select name="kind" required defaultValue="checking" className={FIELD}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit_card">Credit card</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Current balance
          <input name="balance" inputMode="decimal" placeholder="2,500.00" className={FIELD} />
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        Bank exports don&apos;t include your balance, so enter it from your bank&apos;s app. For a
        credit card, enter what you owe.
      </p>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? "Adding…" : "Add account"}
        </button>
      </div>
    </form>
  );
}
