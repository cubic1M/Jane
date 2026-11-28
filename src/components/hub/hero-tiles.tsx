"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { PlanHero, SavedHero } from "@/lib/hub/view";
import type { SavedKind } from "@/lib/membership/service";
import { formatWholeDollars } from "@/lib/money";
import { Blinded, ShowValue } from "./blinded";
import { CalcLines, CalcPopup } from "./calc-popup";
import { Meter } from "./charts";

// The home hub's Saved tile (founder: "Saved so far should also have an interaction feature where
// you click on it it expands and shows a summary of where was saved"), and "Your plan" beside it.
// It opens in place, its height animated (.hub-open, none with reduced motion). There is no tile
// for money not yet saved (founder 11-28: removed); the plan link then stands alone.

const CARD =
  "group relative flex min-w-0 flex-col gap-2 border border-zinc-300 bg-white p-4 hover:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-100";
const TOGGLE = "flex w-full min-w-0 flex-col items-start gap-2 text-left";
const LABEL =
  "text-sm font-medium text-zinc-600 group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-zinc-50";
const LINK = "self-start text-sm font-medium underline-offset-2 hover:underline";
const NUMBER_ROW = "flex flex-wrap items-center gap-x-3";

// Whole dollars, rounded (it said $376/yr where the import chip said $377/yr for $376.80).
const dollars = formatWholeDollars;

const KIND_WORDS: Record<SavedKind, string> = {
  refund: "refund",
  cancelled: "cancelled",
  cheaper: "cheaper",
  interest: "more interest",
  done_yourself: "you did it",
};

function Opens({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  return (
    <div id={id} className="hub-open" data-open={open ? "" : undefined} inert={!open}>
      <div>
        <div className="flex flex-col gap-2 border-t border-zinc-300 pt-3 dark:border-zinc-700">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SavedTile({
  saved,
  planItems,
  plan = null,
}: {
  saved: SavedHero;
  planItems: number;
  plan?: PlanHero | null;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const tile = useRef<HTMLDivElement>(null);
  const planButton = useRef<HTMLButtonElement>(null);
  const [showPlan, setShowPlan] = useState(false);
  const closePlan = useCallback(() => setShowPlan(false), []);
  // Only money saved has a tile; before that there is nothing to show but the plan.
  const savedSoFar = saved.label === "Saved so far";
  if (!savedSoFar && planItems === 0) return null;
  // Asking where it came from is asking to see it.
  const toggleOpen = () => {
    if (!open) setShown(true);
    setOpen(!open);
  };
  const planUi = (
    <>
      {planItems > 0 && (
        <button
          ref={planButton}
          type="button"
          aria-expanded={showPlan}
          aria-controls="saved-plan"
          aria-haspopup="dialog"
          data-saved-plan=""
          onClick={() => {
            // The plan's lines are figures: asking for them is asking to see them.
            if (!showPlan) setShown(true);
            setShowPlan(!showPlan);
          }}
          className="relative z-10 self-start text-left text-sm font-medium underline-offset-2 hover:underline"
        >
          {/* The plan's items, as the chat says them ("Your plan for this week is ready: 12
            things"); "ideas" are the tiles' suggestions, a different count (phone walk). */}
          Your plan: {planItems} {planItems === 1 ? "thing" : "things"} ›
        </button>
      )}
      {showPlan && (
        <CalcPopup
          id="saved-plan"
          title="Your plan"
          anchor={tile}
          trigger={planButton}
          onClose={closePlan}
          full={{ href: "/plan", label: "See the whole plan" }}
        >
          {plan ? (
            <CalcLines lines={plan.steps} label="Saved and planned, a year" />
          ) : (
            <p className="text-sm">
              {planItems} {planItems === 1 ? "thing" : "things"} to decide.
            </p>
          )}
          <p data-plan-goal="" className="text-sm">
            {plan?.goal ? (
              <>
                Toward <span className="font-semibold">{plan.goal.name}</span>
                <span className="text-zinc-500"> · {plan.goal.percent}% there</span>
              </>
            ) : (
              <>
                Not toward a goal yet.{" "}
                <Link prefetch={false} href="/goals" className="font-medium underline">
                  Set a goal
                </Link>
              </>
            )}
          </p>
        </CalcPopup>
      )}
    </>
  );
  // No savings yet: just the plan's link, in the page's own flow (no card, nothing to fill).
  if (!savedSoFar) {
    return (
      <div ref={tile} data-hub-tile="plan" className="relative flex flex-col">
        {planUi}
      </div>
    );
  }
  return (
    <div ref={tile} data-hub-tile="saved" className={CARD}>
      <span className={LABEL}>{saved.label}</span>
      <div className={NUMBER_ROW}>
        <span
          data-hub-number="saved"
          className="block text-2xl font-semibold tracking-tight tabular-nums"
        >
          {shown ? dollars(saved.cents) : <Blinded />}
        </span>
        <ShowValue
          shown={shown}
          what={saved.label.toLowerCase()}
          onToggle={() => {
            if (shown) {
              setOpen(false);
              setShowPlan(false);
            }
            setShown(!shown);
          }}
        />
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="saved-where"
        aria-label={`${saved.label}: where it came from`}
        onClick={toggleOpen}
        className={TOGGLE}
      >
        {/* Confirmed money only (the verified savings record); what's expected is apart. */}
        <span data-hub-confirmed="" className="text-xs text-zinc-500">
          Confirmed in your transactions
        </span>
        {saved.expectedCents > 0 && (
          <span
            data-hub-expected=""
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Expected, not confirmed yet:{" "}
            {shown ? `${dollars(saved.expectedCents)}/yr` : <Blinded />}
          </span>
        )}
        <span className="block w-full">
          <Meter
            share={saved.share}
            label={`${Math.round(saved.share * 100)}% of what Jane found`}
          />
        </span>
        <span className="text-sm font-medium underline underline-offset-4">
          {open ? "Less" : "Where it came from"}
        </span>
      </button>
      <Opens id="saved-where" open={open}>
        <ul data-saved-where="" className="flex flex-col gap-1 text-sm tabular-nums">
          {saved.items.map((item, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {item.title}
                <span className="text-zinc-500"> · {KIND_WORDS[item.kind]}</span>
              </span>
              <span className="shrink-0 font-semibold">
                {dollars(item.cents)}
                {item.yearly && <span className="font-normal text-zinc-500">/yr</span>}
              </span>
            </li>
          ))}
        </ul>
        {saved.more > 0 && <p className="text-xs text-zinc-500">and {saved.more} more</p>}
        <Link prefetch={false} href="/saved" className={LINK}>
          See every saving ›
        </Link>
      </Opens>
      {planUi}
    </div>
  );
}
