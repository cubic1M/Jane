"use client";

import { useActionState } from "react";
import { DRAFT_FIELDS } from "@/config/draft-return";
import { DEDUCTION_KINDS } from "@/config/prior-return";
import { FILING_STATUSES } from "@/config/tax";
import type { DraftFields, DraftSource } from "@/planning/draft-return";
import { draftAction, type DraftState } from "./actions";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const LINKISH = "text-sm font-medium text-emerald-700 underline";

const SOURCE: Record<DraftSource, string> = {
  document: "from the draft",
  you: "as you typed it",
  profile: "from your tax profile",
  demo: "from the sample draft (stand-in reader)",
};

// What Jane read off the draft, each field with where it came from, to fix and confirm.
export function DraftForm({
  id,
  fields,
  sources,
  notes,
}: {
  id: string;
  fields: DraftFields;
  sources: Partial<Record<string, DraftSource>>;
  notes: Partial<Record<string, string>>;
}) {
  const [state, action, pending] = useActionState<DraftState, FormData>(draftAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DRAFT_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-sm">
              {f.label}
              {f.type === "money" || f.type === "signed" ? " ($)" : ""}
            </span>
            {f.key === "filingStatus" || f.key === "deductionKind" ? (
              <select name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT}>
                <option value="">Pick one</option>
                {Object.entries(f.key === "filingStatus" ? FILING_STATUSES : DEDUCTION_KINDS).map(
                  ([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <input name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT} />
            )}
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {sources[f.key] ? SOURCE[sources[f.key]!] : "Not found: type it from the draft"}
              {" · "}
              {f.line}
              {notes[f.key] ? ` · ${notes[f.key]}` : ""}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" name="intent" value="confirm" disabled={pending} className={BUTTON}>
          Confirm and check it
        </button>
        <button type="submit" name="intent" value="dismiss" disabled={pending} className={LINKISH}>
          This isn&apos;t a draft return
        </button>
      </div>
      <p
        role="status"
        className={
          state ? (state.ok ? "text-sm text-emerald-800" : "text-sm text-red-700") : "sr-only"
        }
      >
        {state?.message ?? ""}
      </p>
    </form>
  );
}
