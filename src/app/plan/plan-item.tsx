"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { PlanOption } from "@/config/plan";
import { answerItem, undoItem, type ItemState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export type PlanItemView = {
  findingId: string;
  cardHash: string;
  actionType: string;
  title: string;
  whatChanges: string;
  savings: string;
  urgent: boolean;
  options: readonly PlanOption[];
};

function Done({ state }: { state: Exclude<ItemState, null> }) {
  const [undoState, undo, undoing] = useActionState<ItemState, FormData>(undoItem, null);
  if (undoState?.kind === "undone") {
    return <p role="status">Taken back. It&apos;s on your plan again.</p>;
  }
  if (state.kind === "approved") {
    return (
      <p role="status" className="text-emerald-700">
        Approved{state.changed ? " with your changes" : ""}. Jane is on it; follow along on{" "}
        <Link href="/actions" className="font-medium underline">
          your actions
        </Link>
        .
      </p>
    );
  }
  if (state.kind === "declined") {
    return (
      <form action={undo} className="flex flex-wrap items-center gap-3">
        <p role="status">Skipped.</p>
        <input type="hidden" name="decisionId" value={state.decisionId} />
        <SubmitButton disabled={undoing} className="text-sm font-medium underline">
          Undo
        </SubmitButton>
        {undoState?.kind === "error" && (
          <span role="alert" className="text-sm text-red-700 dark:text-red-400">
            {undoState.message}
          </span>
        )}
      </form>
    );
  }
  return null;
}

export function PlanItem({ item }: { item: PlanItemView }) {
  const [state, action, pending] = useActionState<ItemState, FormData>(answerItem, null);
  const [changing, setChanging] = useState(false);
  const answered = state && state.kind !== "error";

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        {item.urgent && (
          <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950">
            Time-sensitive
          </span>
        )}
        <h2 className="font-semibold [overflow-wrap:anywhere]">{item.title}</h2>
        <p className="text-zinc-700 dark:text-zinc-300">{item.whatChanges}</p>
        <p className="text-sm font-medium">{item.savings}</p>
        <Link
          href={`/report/${item.findingId}`}
          className="w-fit text-sm text-emerald-700 hover:underline"
        >
          Why Jane suggests this<span className="sr-only">: {item.title}</span>
        </Link>
      </div>
      {answered ? (
        <Done state={state} />
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="findingId" value={item.findingId} />
          <input type="hidden" name="cardHash" value={item.cardHash} />
          <input type="hidden" name="actionType" value={item.actionType} />
          <input type="hidden" name="changed" value={String(changing)} />
          {changing && (
            <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
              <legend className="sr-only">Change what Jane does</legend>
              {item.options.map((option) =>
                option.kind === "choice" ? (
                  <label
                    key={option.key}
                    className="flex min-w-0 flex-col gap-1 text-sm font-medium"
                  >
                    {option.label}
                    <select name={`option.${option.key}`} className={`${FIELD} w-full max-w-full`}>
                      {option.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label
                    key={option.key}
                    className="flex min-w-0 flex-col gap-1 text-sm font-medium"
                  >
                    {option.label}
                    <input name={`option.${option.key}`} inputMode="decimal" className={FIELD} />
                    <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                      {option.hint}
                    </span>
                  </label>
                ),
              )}
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
            {item.options.length > 0 && (
              <button
                type="button"
                onClick={() => setChanging(!changing)}
                aria-expanded={changing}
                className={SECONDARY}
              >
                {changing ? "Keep Jane's version" : "Change"}
                <span className="sr-only">: {item.title}</span>
              </button>
            )}
          </div>
          {state?.kind === "error" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {state.message}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
