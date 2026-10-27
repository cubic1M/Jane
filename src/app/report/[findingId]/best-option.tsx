"use client";

import { useState } from "react";
import type { Comparison, Scored } from "@/planning/compare";
import { DecisionButtons } from "./decision-buttons";
import { dayLabel } from "@/lib/day-label";

// The best option for this person, picked by Jane and already selected, with the runners
// up and the choice not to switch (spec step 76). One yes switches to whichever is picked.

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });

function priceOf(s: Scored): string {
  if (s.option.apyBps !== null) return `${(s.option.apyBps / 100).toFixed(2)}% a year`;
  return s.option.monthlyCents === null ? "" : `${money(s.option.monthlyCents)} a month`;
}

function gainOf(s: Scored, savings: boolean): string {
  return savings
    ? `Earns about ${money(s.savingCents)} more a year`
    : `Saves about ${money(s.savingCents)} in the first year`;
}

function OptionRow({
  scored,
  pick,
  savings,
  checked,
  onPick,
}: {
  scored: Scored;
  pick: boolean;
  savings: boolean;
  checked: boolean;
  onPick: () => void;
}) {
  const { option } = scored;
  return (
    <label
      className={`flex min-w-0 cursor-pointer gap-3 rounded-xl border p-4 ${checked ? "border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <input
        type="radio"
        name="switchTo"
        value={option.id}
        checked={checked}
        onChange={onPick}
        className="mt-1 size-4 shrink-0 accent-emerald-700"
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words">{option.name}</span>
          {pick && (
            <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">
              Jane&apos;s pick
            </span>
          )}
          {option.demo && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-50">
              Example, not a real offer
            </span>
          )}
        </span>
        <span className="text-sm">
          {priceOf(scored)} · <strong>{gainOf(scored, savings)}</strong>
        </span>
        {option.includes && (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{option.includes}</span>
        )}
        {scored.notes.length > 0 && (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {scored.notes.join(" · ")}
          </span>
        )}
        <span className="text-xs text-zinc-500">
          Price checked {dayLabel(option.checkedAt, { year: true })} ·{" "}
          <a
            href={option.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            source
          </a>
        </span>
      </span>
    </label>
  );
}

export function BestOption({
  comparison,
  keepLabel,
  findingId,
  cardHash,
  undoSeconds,
  diy,
  readOnly = false,
}: {
  comparison: Comparison;
  keepLabel: string;
  findingId: string;
  cardHash: string;
  undoSeconds: number;
  diy: boolean;
  // Read-only mode: the pick shows how to switch instead of asking Jane to.
  readOnly?: boolean;
}) {
  const [picked, setPicked] = useState(comparison.pick.option.id);
  const savings = comparison.current.kind === "savings";
  const all = [comparison.pick, ...comparison.runnersUp];
  const chosen = all.find((s) => s.option.id === picked);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="best-option">
      <div className="flex flex-col gap-1">
        <h2 id="best-option" className="text-lg font-semibold">
          The best option for you
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {comparison.why} {savings ? "Rates change; Jane shows the date each was checked." : ""}
        </p>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Pick an option</legend>
        {all.map((s, i) => (
          <OptionRow
            key={s.option.id}
            scored={s}
            pick={i === 0}
            savings={savings}
            checked={picked === s.option.id}
            onPick={() => setPicked(s.option.id)}
          />
        ))}
        <label
          className={`flex min-w-0 cursor-pointer gap-3 rounded-xl border p-4 ${picked === "keep" ? "border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950" : "border-zinc-200 dark:border-zinc-800"}`}
        >
          <input
            type="radio"
            name="switchTo"
            value="keep"
            checked={picked === "keep"}
            onChange={() => setPicked("keep")}
            className="mt-1 size-4 shrink-0 accent-emerald-700"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold">Don&apos;t switch</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{keepLabel}</span>
          </span>
        </label>
      </fieldset>
      <DecisionButtons
        findingId={findingId}
        cardHash={cardHash}
        undoSeconds={undoSeconds}
        diy={diy}
        switchTo={picked}
        yesLabel={chosen ? `Yes, switch to ${chosen.option.name}` : "Yes, do this for me"}
        readOnly={readOnly}
        showLabel={chosen ? `Show me how to switch to ${chosen.option.name}` : "Show me how"}
      />
    </section>
  );
}
