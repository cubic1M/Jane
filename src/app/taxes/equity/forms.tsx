"use client";

import { useActionState } from "react";
import { EQUITY_EVENT_KINDS } from "@/config/equity-tax";
import { equityAction, type EquityState } from "./actions";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";

function Status({ state }: { state: EquityState }) {
  return (
    <p
      role="status"
      className={
        state ? (state.ok ? "text-sm text-emerald-800" : "text-sm text-red-700") : "sr-only"
      }
    >
      {state?.message ?? ""}
    </p>
  );
}

function Field({
  name,
  label,
  type = "text",
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <input
        name={name}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        className={INPUT}
      />
      {hint && <span className="text-xs text-zinc-600 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

export function EventForm() {
  const [state, action, pending] = useActionState<EquityState, FormData>(equityAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="add" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">What happened</span>
          <select name="kind" className={INPUT} defaultValue="rsu">
            {Object.entries(EQUITY_EVENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Field name="company" label="Company" />
        <Field name="shares" label="Shares" />
        <Field name="occurredOn" label="Vested, bought or exercised on" type="date" />
        <Field name="fmv" label="Market price per share that day ($)" />
        <Field
          name="price"
          label="Price you paid per share ($)"
          hint="Strike for options; 0 for RSUs."
        />
        <Field name="grantedOn" label="Offering or grant date" type="date" hint="ESPP and ISOs." />
        <Field
          name="withheld"
          label="Tax withheld on an RSU vest ($)"
          hint="Leave empty if you don't know."
        />
        <Field name="soldOn" label="Sold on" type="date" hint="If you sold." />
        <Field name="soldPrice" label="Sold at per share ($)" />
        <Field
          name="grantDiscount"
          label="ESPP discount per share at the offering ($)"
          hint="If you know it."
        />
      </div>
      <button type="submit" disabled={pending} className={BUTTON}>
        Add it
      </button>
      <Status state={state} />
    </form>
  );
}

export function RemoveButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<EquityState, FormData>(equityAction, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${label}`}
        className="text-sm font-medium text-emerald-700 underline"
      >
        Remove
      </button>
      <Status state={state} />
    </form>
  );
}

export function AsideButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState<EquityState, FormData>(equityAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value="aside" />
      <button type="submit" disabled={pending} className={BUTTON}>
        {label}
      </button>
      <Status state={state} />
    </form>
  );
}
