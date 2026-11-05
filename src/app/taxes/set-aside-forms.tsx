"use client";

import { useActionState } from "react";
import { pointOutAction, undoPointOutAction, type PointOutState } from "./set-aside-actions";

// The buttons on the tax calculation (/taxes): point something out, or undo it. On /taxes only, so
// Home's JavaScript budget doesn't carry them.

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";
const FIELD =
  "min-h-11 w-full rounded border border-zinc-400 bg-transparent px-2 text-sm dark:border-zinc-600";

function Status({ state }: { state: PointOutState }) {
  return (
    <span role="status" className={state?.ok === false ? "text-sm font-semibold" : "text-sm"}>
      {state?.message ?? ""}
    </span>
  );
}

export function NotIncomeButton({ payerKey, label }: { payerKey: string; label: string }) {
  const [state, action, pending] = useActionState(pointOutAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value="not_income" />
      <input type="hidden" name="payerKey" value={payerKey} />
      <button type="submit" disabled={pending} className={BUTTON}>
        That isn&apos;t income<span className="sr-only">: {label}</span>
      </button>
      <Status state={state} />
    </form>
  );
}

export function PointOutForm() {
  const [state, action, pending] = useActionState(pointOutAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        What should Jane know?
        <select name="kind" className={FIELD} defaultValue="deduction">
          <option value="deduction">That&apos;s a deduction</option>
          <option value="business_cost">That&apos;s a cost of my work</option>
          <option value="paid_federal">I paid this to the IRS</option>
          <option value="paid_state">I paid this to my state</option>
          <option value="wages">My wages so far are this</option>
          <option value="self_employed">My self-employment income so far is this</option>
          <option value="withheld">Federal tax withheld so far is this</option>
          <option value="kept_apart">I already keep this much apart for tax</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Amount
        <input name="amount" inputMode="decimal" required className={FIELD} placeholder="$0.00" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        What it is (optional)
        <input name="label" maxLength={80} className={FIELD} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          Work it out again
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function UndoButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(undoPointOutAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={BUTTON}>
        Undo<span className="sr-only">: {label}</span>
      </button>
      <Status state={state} />
    </form>
  );
}
