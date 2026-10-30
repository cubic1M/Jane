"use client";

import { useActionState } from "react";
import { saveOption, type OptionState } from "./actions";

const INPUT =
  "h-10 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700";

function Field({
  name,
  label,
  hint,
  type = "text",
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" htmlFor={`option-${name}`}>
      {label}
      <input id={`option-${name}`} name={name} type={type} className={INPUT} />
      {hint && <span className="font-normal text-zinc-500">{hint}</span>}
    </label>
  );
}

export function OptionForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<OptionState, FormData>(saveOption, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="option-kind">
        What it is
        <select id="option-kind" name="kind" className={INPUT} defaultValue="plan">
          <option value="plan">Another provider&apos;s plan</option>
          <option value="tier">A cheaper tier of the same service</option>
          <option value="savings">A savings account</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="option-category">
        Replaces (plans)
        <select id="option-category" name="category" className={INPUT} defaultValue="phone">
          <option value="phone">Phone bill</option>
          <option value="internet_tv">Internet and TV bill</option>
        </select>
      </label>
      <Field
        name="merchant"
        label="Service it's a tier of (tiers)"
        hint="As on statements, e.g. Netflix."
      />
      <Field name="provider" label="Provider" />
      <Field name="name" label="Option name" />
      <Field name="monthly" label="Price a month ($), plans and tiers" />
      <Field name="apy" label="Yearly rate, APY (%), savings" />
      <Field name="contractMonths" label="Contract (months)" hint="0 or empty for none." />
      <Field name="fee" label="One-time fee ($)" />
      <Field name="minimumBalance" label="Minimum balance ($), savings" />
      <Field name="includes" label="What's included, one line" />
      <Field name="givesUp" label="What's given up, one line" />
      <Field name="signUpUrl" label="Sign-up link" />
      <Field name="sourceUrl" label="Where the price comes from (https)" />
      <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="option-checkedAt">
        Price checked on
        <input
          id="option-checkedAt"
          name="checkedAt"
          type="date"
          defaultValue={today}
          max={today}
          className={INPUT}
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="reviewed" className="h-4 w-4" />I checked this on the
        provider&apos;s own page; Jane may compare it
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
        {pending ? "Saving…" : "Add option"}
      </button>
    </form>
  );
}
