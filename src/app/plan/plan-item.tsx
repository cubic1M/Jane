"use client";

import Link from "next/link";
import { isHiddenPage } from "@/config/hidden-pages";
import { useRef, useState } from "react";
import type { PlanOption } from "@/config/plan";
import { answerItem, revertItem, type ItemState } from "./actions";

const PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const CHOSEN =
  "inline-flex h-11 items-center justify-center gap-1 rounded-full border-2 border-zinc-950 bg-zinc-950 px-5 font-semibold text-white dark:border-white dark:bg-white dark:text-zinc-950";
const GREYED =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold opacity-40 dark:border-zinc-700";
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

type Choice = "yes" | "no";

// One item on the plan. A tap is answered on screen at once (founder, 2026-10-25: "it should be
// instant ... not just remove the options, just grey them out, and there should be a revert
// button"): the choice is marked, the other greyed, and Revert offered, while the answer is saved
// behind; only an error puts it back, with one line. Read-only mode (a real account): "Show me
// how" opens the item's page, with Jane's steps, drafts and Mark done, and nothing else.
export function PlanItem({ item, readOnly = false }: { item: PlanItemView; readOnly?: boolean }) {
  const [chosen, setChosen] = useState<{ choice: Choice; changed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  // The answer on its way to the server, so Revert follows it.
  const sending = useRef<Promise<ItemState> | null>(null);

  function answer(choice: Choice, form: HTMLFormElement) {
    const data = new FormData(form);
    data.set("choice", choice);
    setChosen({ choice, changed: choice === "yes" && changing });
    setChanging(false);
    setError(null);
    const sent = answerItem(null, data).catch((): ItemState => ({
      kind: "error",
      message: "That didn't go through. Try again.",
    }));
    sending.current = sent;
    void sent.then((state) => {
      if (sending.current !== sent || state?.kind !== "error") return;
      setChosen(null);
      setError(state.message);
    });
  }

  function revert() {
    const was = chosen;
    const sent = sending.current;
    if (!was || !sent) return;
    setChosen(null);
    setError(null);
    sending.current = null;
    void sent
      .then((state) =>
        state && (state.kind === "approved" || state.kind === "declined")
          ? revertItem(state.decisionId, was.choice)
          : null,
      )
      .catch((): ItemState => ({ kind: "error", message: "That didn't go through. Try again." }))
      .then((state) => {
        if (state?.kind !== "error") return;
        setChosen(was);
        sending.current = sent;
        setError(state.message);
      });
  }

  const choiceButton = (choice: Choice, label: string, style: string) =>
    chosen ? (
      <button
        type="button"
        disabled
        aria-pressed={chosen.choice === choice}
        className={chosen.choice === choice ? CHOSEN : GREYED}
      >
        {label}
        {chosen.choice === choice && <span aria-hidden="true"> [✓ chosen]</span>}
        <span className="sr-only">
          : {item.title}
          {chosen.choice === choice ? ", chosen" : ""}
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={(e) => answer(choice, e.currentTarget.form!)}
        className={style}
      >
        {label}
        <span className="sr-only">: {item.title}</span>
      </button>
    );

  return (
    <li
      data-plan-item={item.findingId}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
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
      {readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/report/${item.findingId}`} className={PRIMARY}>
            Show me how<span className="sr-only">: {item.title}</span>
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
          <input type="hidden" name="findingId" value={item.findingId} />
          <input type="hidden" name="cardHash" value={item.cardHash} />
          <input type="hidden" name="actionType" value={item.actionType} />
          <input type="hidden" name="changed" value={String(changing)} />
          {changing && !chosen && (
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
          <div className="flex flex-wrap gap-2" data-plan-choices="">
            {choiceButton("yes", changing ? "Yes, with these changes" : "Yes", PRIMARY)}
            {choiceButton("no", "No", SECONDARY)}
            {chosen ? (
              <button type="button" onClick={revert} className={SECONDARY}>
                <span aria-hidden="true">↶ </span>Revert
                <span className="sr-only">: {item.title}</span>
              </button>
            ) : (
              item.options.length > 0 && (
                <button
                  type="button"
                  onClick={() => setChanging(!changing)}
                  aria-expanded={changing}
                  className={SECONDARY}
                >
                  {changing ? "Keep Jane's version" : "Change"}
                  <span className="sr-only">: {item.title}</span>
                </button>
              )
            )}
          </div>
          {chosen && (
            <p role="status" className="text-sm">
              {chosen.choice === "yes" ? (
                <>
                  Approved{chosen.changed ? " with your changes" : ""}. Jane is on it
                  {!isHiddenPage("/actions") && (
                    <>
                      ; follow along on{" "}
                      <Link href="/actions" className="font-medium underline">
                        your actions
                      </Link>
                    </>
                  )}
                  .
                </>
              ) : (
                "Skipped."
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
