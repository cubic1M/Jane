"use client";

import { useActionState } from "react";
import { RULE_MONTHLY_LIMITS } from "@/config/rules";
import { saveStandingRules, type RulesState } from "./rules-actions";

const FIELD =
  "h-10 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700";

export type RuleRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  monthlyLimit: number;
  maxAmountLabel: string | null;
  maxDollars: string;
};

export function RulesForm({ rules }: { rules: RuleRow[] }) {
  const [state, action, pending] = useActionState<RulesState, FormData>(saveStandingRules, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {rules.map((rule) => (
          <li
            key={rule.key}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name={`${rule.key}.enabled`}
                defaultChecked={rule.enabled}
                className="mt-1 size-5 shrink-0"
              />
              <span className="flex flex-col">
                <span className="font-medium">{rule.label}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{rule.description}</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-3 pl-8">
              <label className="flex flex-col gap-1 text-xs font-medium">
                At most, per month
                <select
                  name={`${rule.key}.limit`}
                  defaultValue={rule.monthlyLimit}
                  className={FIELD}
                >
                  {RULE_MONTHLY_LIMITS.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "time" : "times"}
                    </option>
                  ))}
                </select>
              </label>
              {rule.maxAmountLabel && (
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {rule.maxAmountLabel}
                  <input
                    name={`${rule.key}.max`}
                    inputMode="decimal"
                    defaultValue={rule.maxDollars}
                    className={`${FIELD} w-28`}
                  />
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save rules"}
      </button>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
