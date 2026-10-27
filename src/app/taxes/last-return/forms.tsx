"use client";

import { useActionState } from "react";
import { PRIOR_RETURN_FIELDS } from "@/config/prior-return";
import { FILING_STATUSES } from "@/config/tax";
import { DEDUCTION_KINDS } from "@/config/prior-return";
import { SOURCE_WORDS, type Fields, type Source } from "@/planning/prior-return";
import { returnAction, type ReturnState } from "./actions";
import { FormStatus } from "@/components/form-status";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const LINKISH = "text-sm font-medium text-emerald-700 underline";

// What Jane read, each field with where it came from, for the person to fix and confirm.
export function ReadingForm({
  id,
  fields,
  sources,
  notes,
}: {
  id: string;
  fields: Fields;
  sources: Partial<Record<string, Source>>;
  notes: Partial<Record<string, string>>;
}) {
  const [state, action, pending] = useActionState<ReturnState, FormData>(returnAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRIOR_RETURN_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-sm">
              {f.label}
              {f.type === "money" || f.type === "signed" ? " ($)" : ""}
            </span>
            {f.key === "filingStatus" ? (
              <select name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT}>
                <option value="">Pick one</option>
                {Object.entries(FILING_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            ) : f.key === "deductionKind" ? (
              <select name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT}>
                <option value="">Pick one</option>
                {Object.entries(DEDUCTION_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT} />
            )}
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {sources[f.key]
                ? SOURCE_WORDS[sources[f.key]!]
                : "Not found: type it from your return"}
              {" · "}
              {f.line}
              {notes[f.key] ? ` · ${notes[f.key]}` : ""}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" name="intent" value="confirm" disabled={pending} className={BUTTON}>
          Confirm
        </button>
        <button type="submit" name="intent" value="dismiss" disabled={pending} className={LINKISH}>
          This isn&apos;t my return
        </button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

export function PrepareForm({ year }: { year: number }) {
  const [state, action, pending] = useActionState<ReturnState, FormData>(returnAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="prepare" />
      <input type="hidden" name="year" value={year} />
      <button type="submit" disabled={pending} className={BUTTON}>
        Prepare the amended return
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function SignAmendmentForm({ year }: { year: number }) {
  const [state, action, pending] = useActionState<ReturnState, FormData>(returnAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="sign" />
      <input type="hidden" name="year" value={year} />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="reviewed" className="mt-1 size-5" />
        <span>
          I&apos;ve reviewed this amended return and, to the best of my knowledge, it&apos;s true,
          correct and complete.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Sign with your full legal name</span>
        <input name="signature" autoComplete="name" className={INPUT} />
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        Sign and file
      </button>
      <FormStatus state={state} />
    </form>
  );
}
