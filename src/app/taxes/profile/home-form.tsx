"use client";

import { useActionState } from "react";
import { saveHomeAction, type TaxProfileState } from "./actions";

// Points and a home sale (spec step 170): what Jane can't see in the accounts. Leave a
// part empty to clear it.

export type HomeValues = {
  year: number;
  points: string;
  pointsPurchase: boolean;
  pointsLoanYears: string;
  boughtOn: string;
  price: string;
  soldOn: string;
  sale: string;
  costs: string;
  daysLivedIn: string;
};

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

function Field({
  name,
  label,
  value,
  type = "text",
}: {
  name: string;
  label: string;
  value: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <input
        name={name}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        defaultValue={value}
        className={INPUT}
      />
    </label>
  );
}

export function HomeForm({ values }: { values: HomeValues }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(saveHomeAction, null);
  return (
    <form
      action={action}
      id="home"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="font-semibold">Your home</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Jane finds your mortgage interest and property tax itself. Add points you paid in{" "}
        {values.year} and a home sale; leave a part empty to clear it.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="points" label={`Points paid in ${values.year} ($)`} value={values.points} />
        <Field name="pointsLoanYears" label="Loan length (years)" value={values.pointsLoanYears} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="pointsPurchase" defaultChecked={values.pointsPurchase} />
        The points were for buying the home (not a refinance)
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="boughtOn" label="Bought on" value={values.boughtOn} type="date" />
        <Field name="price" label="Price paid ($)" value={values.price} />
        <Field name="soldOn" label="Sold on" value={values.soldOn} type="date" />
        <Field name="sale" label="Sale price ($)" value={values.sale} />
        <Field name="costs" label="Selling costs, like agent fees ($)" value={values.costs} />
        <Field
          name="daysLivedIn"
          label="Days you lived in it, in the 5 years before"
          value={values.daysLivedIn}
        />
      </div>
      <p
        role="status"
        className={
          state
            ? `rounded-lg p-3 text-sm ${
                state.ok
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              }`
            : "sr-only"
        }
      >
        {state?.message ?? ""}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Save home details
      </button>
    </form>
  );
}
