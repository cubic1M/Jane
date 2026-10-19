"use client";

import { useActionState, useState } from "react";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import {
  COVERAGE_FIELDS,
  HOUSING,
  POLICY_KINDS,
  TERM_MONTHS,
  isPolicyKind,
} from "@/config/insurance";
import type { HouseholdInput } from "@/lib/insurance/household";
import type { PolicyInput } from "@/lib/insurance/policies";
import { saveHouseholdFacts, savePolicy, type HouseholdState, type PolicyState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const LABEL = "flex flex-col gap-1 text-sm font-medium";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-end rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";

// One policy, added or edited. The cover fields change with the kind of policy.
export function PolicyForm({ policyId, values }: { policyId: string; values: PolicyInput }) {
  const [state, action, pending] = useActionState<PolicyState, FormData>(savePolicy, null);
  const shown = state ? state.input : values;
  const [kind, setKind] = useState(shown.kind);
  const id = (name: string) => `${policyId || "new"}-${name}`;
  const fields = isPolicyKind(kind) ? COVERAGE_FIELDS[kind] : [];
  return (
    <form action={action} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <input type="hidden" name="policyId" value={policyId} />
      <label htmlFor={id("kind")} className={LABEL}>
        What it insures
        <select
          id={id("kind")}
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={INPUT}
        >
          {Object.entries(POLICY_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("carrier")} className={LABEL}>
        Insurance company
        <input
          id={id("carrier")}
          name="carrier"
          defaultValue={shown.carrier}
          placeholder="GEICO"
          className={INPUT}
        />
      </label>
      <label htmlFor={id("premium")} className={LABEL}>
        Price ($)
        <input
          id={id("premium")}
          name="premium"
          inputMode="decimal"
          defaultValue={shown.premium}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("premiumFrequency")} className={LABEL}>
        Paid
        <select
          id={id("premiumFrequency")}
          name="premiumFrequency"
          defaultValue={shown.premiumFrequency}
          className={INPUT}
        >
          <option value="">Not sure</option>
          {Object.entries(PREMIUM_FREQUENCIES).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("deductible")} className={LABEL}>
        Deductible ($)
        <input
          id={id("deductible")}
          name="deductible"
          inputMode="decimal"
          defaultValue={shown.deductible}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("renewalDate")} className={LABEL}>
        Renews on
        <input
          id={id("renewalDate")}
          name="renewalDate"
          type="date"
          defaultValue={shown.renewalDate}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("termMonths")} className={LABEL}>
        Each term lasts
        <select
          id={id("termMonths")}
          name="termMonths"
          defaultValue={shown.termMonths || "12"}
          className={INPUT}
        >
          {TERM_MONTHS.map((m) => (
            <option key={m} value={m}>
              {m} months
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("covers")} className={LABEL}>
        What it covers (optional)
        <input
          id={id("covers")}
          name="covers"
          defaultValue={shown.covers}
          placeholder="One car, two drivers"
          className={INPUT}
        />
      </label>
      {fields.length > 0 && (
        <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Cover limits (if you know them)</legend>
          {fields.map((field) => (
            <label key={field.key} htmlFor={id(field.key)} className={LABEL}>
              {field.label}
              {field.type === "money" && " ($)"}
              {field.type === "percent" && " (%)"}
              {field.type === "yesno" ? (
                <select
                  id={id(field.key)}
                  name={`coverage.${field.key}`}
                  defaultValue={shown.coverage[field.key] ?? ""}
                  className={INPUT}
                >
                  <option value="">Not sure</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input
                  id={id(field.key)}
                  name={`coverage.${field.key}`}
                  inputMode="numeric"
                  defaultValue={shown.coverage[field.key] ?? ""}
                  className={INPUT}
                />
              )}
            </label>
          ))}
        </fieldset>
      )}
      {state && (
        <p role="alert" className="text-red-700 sm:col-span-2 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving…" : policyId ? "Save" : "Add it"}
      </button>
    </form>
  );
}

// Where the person lives and who depends on them. Blank lets Jane read it from the
// accounts.
export function HouseholdForm({
  values,
  hints,
}: {
  values: HouseholdInput;
  // What the accounts say, shown under a blank field.
  hints: Partial<Record<keyof HouseholdInput, string>>;
}) {
  const [state, action, pending] = useActionState<HouseholdState, FormData>(
    saveHouseholdFacts,
    null,
  );
  const shown = state ? state.input : values;
  const hint = (key: keyof HouseholdInput) =>
    hints[key] ? <span className="text-xs font-normal text-zinc-500">{hints[key]}</span> : null;
  return (
    <form action={action} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <label htmlFor="household-housing" className={LABEL}>
        Your home
        <select
          id="household-housing"
          name="housing"
          defaultValue={shown.housing}
          className={INPUT}
        >
          <option value="">Not saying</option>
          {Object.entries(HOUSING).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {hint("housing")}
      </label>
      {(
        [
          ["vehicles", "Cars"],
          ["dependants", "People who depend on you"],
          ["pets", "Pets"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} htmlFor={`household-${key}`} className={LABEL}>
          {label}
          <input
            id={`household-${key}`}
            name={key}
            inputMode="numeric"
            defaultValue={shown[key]}
            className={INPUT}
          />
          {hint(key)}
        </label>
      ))}
      {state && (
        <p role="alert" className="text-red-700 sm:col-span-2 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
