"use client";

import { useActionState } from "react";
import { saveHelper, type HelperState } from "./actions";

// One small form on the freelance taxes page (spec step 123).

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

export function HelperForm({
  intent,
  fields,
  button,
}: {
  intent: "office" | "miles" | "payment";
  fields: {
    name: string;
    label: string;
    value: string;
    type?: string;
    options?: { value: string; label: string }[];
  }[];
  button: string;
}) {
  const [state, action, pending] = useActionState<HelperState, FormData>(saveHelper, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value={intent} />
      <div className="flex flex-wrap items-end gap-2">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-sm">{f.label}</span>
            {f.options ? (
              <select name={f.name} defaultValue={f.value} className={INPUT}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={f.value}
                inputMode={f.type ? undefined : "decimal"}
                className={INPUT}
              />
            )}
          </label>
        ))}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {button}
        </button>
      </div>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
