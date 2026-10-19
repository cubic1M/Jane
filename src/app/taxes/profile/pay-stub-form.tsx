"use client";

import { useActionState } from "react";
import { savePayStubAction, type TaxProfileState } from "./actions";

// From the latest pay stub (spec step 120): year-to-date figures, for a refund-or-owe
// estimate when there's no payroll connection. Leave gross pay empty to clear it.

export type PayStubValues = {
  asOf: string;
  gross: string;
  federal: string;
  state: string;
  retirement: string;
  pretax: string;
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

export function PayStubForm({ values, demo }: { values: PayStubValues; demo: boolean }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(
    savePayStubAction,
    null,
  );
  return (
    <form
      action={action}
      id="pay-stub"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="font-semibold">From your latest pay stub</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {demo
          ? "The demo bank comes with sample pay stubs, so Jane already has these. Anything you type here is used for real accounts."
          : "Year-to-date figures, so Jane can tell whether you're on course for a refund or a bill. Leave gross pay empty to clear them."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="payAsOf" label="Pay stub date" value={values.asOf} type="date" />
        <Field name="payGross" label="Gross pay this year ($)" value={values.gross} />
        <Field name="payFederal" label="Federal income tax withheld ($)" value={values.federal} />
        <Field name="payState" label="State income tax withheld ($)" value={values.state} />
        <Field
          name="payRetirement"
          label="Pre-tax 401(k) or 403(b) ($)"
          value={values.retirement}
        />
        <Field name="payPretax" label="Other pre-tax: health, HSA, FSA ($)" value={values.pretax} />
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
        Save pay stub figures
      </button>
    </form>
  );
}
