"use client";

import { useActionState } from "react";
import { NOTICE_FIELDS, NOTICE_KINDS } from "@/config/tax-notices";
import { SOURCE_WORDS, type Fields, type Source } from "@/planning/tax-notice";
import { letterAction, type LetterState } from "./actions";
import { FormStatus } from "@/components/form-status";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const SECOND =
  "inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-400 px-5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";

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
  const [state, action, pending] = useActionState<LetterState, FormData>(letterAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NOTICE_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-sm">{f.label}</span>
            {f.key === "kind" ? (
              <select name={f.key} defaultValue={fields[f.key] ?? ""} className={INPUT}>
                <option value="">Pick one</option>
                {Object.entries(NOTICE_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.key}
                type={f.type === "date" ? "date" : "text"}
                defaultValue={fields[f.key] ?? ""}
                className={INPUT}
              />
            )}
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {sources[f.key]
                ? SOURCE_WORDS[sources[f.key]!]
                : "Not found: type it from the notice"}
              {notes[f.key] ? ` · ${notes[f.key]}` : ""}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" name="intent" value="confirm" disabled={pending} className={BUTTON}>
          Confirm
        </button>
        <button
          type="submit"
          name="intent"
          value="dismiss"
          disabled={pending}
          className="text-sm font-medium text-emerald-700 underline"
        >
          This isn&apos;t a tax notice
        </button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

export function ResponseButtons({
  id,
  responses,
  pointed,
}: {
  id: string;
  responses: readonly string[];
  pointed: string | null;
}) {
  const [state, action, pending] = useActionState<LetterState, FormData>(letterAction, null);
  const LABEL: Record<string, string> = {
    agree: "Draft: I agree",
    pay: "Draft: I'm paying",
    dispute: "Draft: I disagree",
  };
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      {responses.map((r) => (
        <button
          key={r}
          type="submit"
          name="intent"
          value={r}
          disabled={pending}
          className={r === pointed ? BUTTON : SECOND}
        >
          {LABEL[r]}
        </button>
      ))}
      <FormStatus state={state} />
    </form>
  );
}

export function SendButtons({ id }: { id: string }) {
  const [state, action, pending] = useActionState<LetterState, FormData>(letterAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="intent" value="team" disabled={pending} className={BUTTON}>
        Have Jane&apos;s team send it
      </button>
      <button type="submit" name="intent" value="you" disabled={pending} className={SECOND}>
        I&apos;ll send it myself
      </button>
      <FormStatus state={state} />
    </form>
  );
}
