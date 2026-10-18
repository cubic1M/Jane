"use client";

import { useActionState, useState } from "react";
import { answerSetup, type ProposalState } from "./actions";

const PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export type SetupView = {
  key: string;
  title: string;
  basis: string;
  // What Change lets the person edit.
  fields: (
    | { kind: "amount"; label: string; value: string }
    | { kind: "date"; label: string; value: string }
    | {
        kind: "category";
        label: string;
        value: string;
        options: { value: string; label: string }[];
      }
  )[];
};

export function SetupItem({ item }: { item: SetupView }) {
  const [state, action, pending] = useActionState<ProposalState, FormData>(answerSetup, null);
  const [changing, setChanging] = useState(false);
  if (state?.ok) {
    return (
      <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="font-semibold [overflow-wrap:anywhere]">{item.title}</p>
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold [overflow-wrap:anywhere]">{item.title}</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.basis}</p>
      </div>
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="key" value={item.key} />
        {changing && (
          <fieldset className="flex min-w-0 flex-wrap gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <legend className="sr-only">Change it</legend>
            {item.fields.map((field) => (
              <label
                key={field.kind}
                className="flex max-w-full min-w-0 flex-col gap-1 text-sm font-medium"
              >
                {field.label}
                {field.kind === "category" ? (
                  <select
                    name="detailed"
                    defaultValue={field.value}
                    className={`${FIELD} w-full max-w-full`}
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={field.kind}
                    type={field.kind === "date" ? "date" : "text"}
                    inputMode={field.kind === "amount" ? "decimal" : undefined}
                    defaultValue={field.value}
                    className={FIELD}
                  />
                )}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="choice" value="yes" disabled={pending} className={PRIMARY}>
            {changing ? "Yes, with these changes" : "Yes"}
            <span className="sr-only">: {item.title}</span>
          </button>
          <button type="submit" name="choice" value="no" disabled={pending} className={SECONDARY}>
            No<span className="sr-only">: {item.title}</span>
          </button>
          <button
            type="button"
            onClick={() => setChanging(!changing)}
            aria-expanded={changing}
            className={SECONDARY}
          >
            {changing ? "Keep Jane's version" : "Change"}
            <span className="sr-only">: {item.title}</span>
          </button>
        </div>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.message}
          </p>
        )}
      </form>
    </li>
  );
}
