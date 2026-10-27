"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanHero, SafeHero, SavedHero } from "@/lib/hub/view";
import type { SavedKind } from "@/lib/membership/service";
import { formatWholeDollars } from "@/lib/money";
import { CalcLines, CalcPopup } from "./calc-popup";
import { Meter, StackBar } from "./charts";
import { MarchingPath } from "@/components/marching-path";

// The home hub's Safe to spend and Saved tiles (founder: "When you click safe to spend till… it
// should expand first having a summary on why that number is what it is. On the bottom, that box
// should suggest smth like what are u aiming to spend and it would link you to the chat on the
// right with a dotted line … Saved so far should also have an interaction feature where you click
// on it it expands and shows a summary of where was saved"). Each opens in place, its height
// animated (.hub-open, none with reduced motion); the page it used to link to is a link inside.

const CARD =
  "group relative flex min-w-0 flex-col gap-2 border border-zinc-300 bg-white p-4 hover:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-100";
const TOGGLE = "flex w-full min-w-0 flex-col items-start gap-2 text-left";
const LABEL =
  "text-sm font-medium text-zinc-600 group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-zinc-50";
const LINK = "self-start text-sm font-medium underline-offset-2 hover:underline";

// Whole dollars, rounded (it said $376/yr where the import chip said $377/yr for $376.80).
const dollars = formatWholeDollars;

// What goes in the chat's message box: the person types the amount and sends it themselves. The
// hint shows greyed after the cursor until they type, and is never sent (founder: "there should be
// after 'I am aiming to spend' with a clue, like '[dollar amount]'").
export const AIM_PROMPT = "I'm aiming to spend $";
export const AIM_HINT = "[amount] on [what]";

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
        <div className="flex flex-col gap-2 border-t border-dashed border-zinc-300 pt-3 dark:border-zinc-700">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SafeTile({ safe }: { safe: SafeHero }) {
  const [open, setOpen] = useState(false);
  const aim = useRef<HTMLButtonElement>(null);
  const [line, setLine] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [fading, setFading] = useState(false);

  // The line shows for a few seconds, then fades; it follows nothing once drawn.
  useEffect(() => {
    if (!line) return;
    const fade = setTimeout(() => setFading(true), 4500);
    const gone = setTimeout(() => setLine(null), 5000);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [line]);

  const aimToSpend = () => {
    // The side chat comes into view with the prompt waiting in its box (it isn't sent), and
    // says where the box is, for the dotted line from here to it.
    const onBox = (e: Event) => {
      const to = (e as CustomEvent<{ x: number; y: number }>).detail;
      const r = aim.current?.getBoundingClientRect();
      if (!r) return;
      // Toward the chat: from the side it's on (beside the page), or the bottom (a phone's sheet).
      const from =
        to.x > r.right
          ? { x: r.right, y: r.top + r.height / 2 }
          : { x: r.left + r.width / 2, y: r.bottom };
      setFading(false);
      setLine({ from, to });
    };
    window.addEventListener("jane:box", onBox, { once: true });
    setTimeout(() => window.removeEventListener("jane:box", onBox), 5000);
    window.dispatchEvent(
      new CustomEvent("jane:ask", { detail: { text: AIM_PROMPT, hint: AIM_HINT } }),
    );
  };
  const tile = useRef<HTMLDivElement>(null);
  const how = useRef<HTMLButtonElement>(null);
  const [showHow, setShowHow] = useState(false);
  const closeHow = useCallback(() => setShowHow(false), []);

  return (
    <div ref={tile} data-hub-tile="safe" className={`${CARD} col-span-2 sm:col-span-1`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="safe-why"
        onClick={() => setOpen((o) => !o)}
        className={TOGGLE}
      >
        <span className={LABEL}>{safe.label}</span>
        <span
          data-hub-number="safe"
          className={`block text-2xl font-semibold tracking-tight tabular-nums ${safe.short ? "font-bold" : ""}`}
        >
          {safe.short ? `Short ${dollars(safe.cents)}` : dollars(safe.cents)}
        </span>
        <span className="block w-full">
          <StackBar
            parts={safe.parts}
            emphasis="safe"
            label={safe.parts.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(", ")}
          />
        </span>
        <span aria-hidden className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
          {safe.parts.map((p) => (
            <span key={p.key}>
              {p.key === "safe" ? "■" : "□"} {p.label}
            </span>
          ))}
        </span>
        <span className="text-xs font-semibold tracking-wider">
          {open ? "[LESS]" : "[WHY THIS NUMBER]"}
        </span>
      </button>
      <Opens id="safe-why" open={open}>
        <div data-safe-why="">
          <CalcLines lines={safe.why} label="Why this number" />
        </div>
        <button
          ref={how}
          type="button"
          aria-expanded={showHow}
          aria-controls="safe-how"
          aria-haspopup="dialog"
          data-safe-how=""
          onClick={() => setShowHow((o) => !o)}
          className={`${LINK} text-left`}
        >
          How it&apos;s worked out ›
        </button>
        <button
          ref={aim}
          type="button"
          data-aim-to-spend=""
          onClick={aimToSpend}
          className="self-start text-sm font-semibold hover:underline"
        >
          [What are you aiming to spend?]
          <span className="sr-only"> Opens the chat with it ready to type.</span>
        </button>
      </Opens>
      {line && <ChatLine from={line.from} to={line.to} fading={fading} />}
      {showHow && (
        <CalcPopup
          id="safe-how"
          title="How it's worked out"
          anchor={tile}
          trigger={how}
          onClose={closeHow}
          full={{ href: "/figures/safe_to_spend", label: "The full working" }}
        >
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            What&apos;s in checking, less what&apos;s already spoken for before payday.
          </p>
          <CalcLines lines={safe.steps} label="Safe to spend, worked out" />
        </CalcPopup>
      )}
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
  const tile = useRef<HTMLDivElement>(null);
  const planButton = useRef<HTMLButtonElement>(null);
  const [showPlan, setShowPlan] = useState(false);
  const closePlan = useCallback(() => setShowPlan(false), []);
  const savedSoFar = saved.label === "Saved so far";
  const number =
    saved.label === "Money found" && saved.cents === 0 && planItems > 0 ? (
      // As the report says it when nothing has a sure dollar figure yet.
      `${planItems} to look at`
    ) : (
      <>
        {dollars(saved.cents)}
        {saved.perYear && <span className="text-base font-normal text-zinc-500">/yr</span>}
      </>
    );
  return (
    <div ref={tile} data-hub-tile="saved" className={CARD}>
      {savedSoFar ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="saved-where"
          onClick={() => setOpen((o) => !o)}
          className={TOGGLE}
        >
          <span className={LABEL}>{saved.label}</span>
          <span
            data-hub-number="saved"
            className="block text-2xl font-semibold tracking-tight tabular-nums"
          >
            {number}
          </span>
          {/* Confirmed money only (the verified savings record); what's expected is apart. */}
          <span data-hub-confirmed="" className="text-xs text-zinc-500">
            Confirmed in your transactions
          </span>
          {saved.expectedCents > 0 && (
            <span
              data-hub-expected=""
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Expected, not confirmed yet: {dollars(saved.expectedCents)}/yr
            </span>
          )}
          <span className="block w-full">
            <Meter
              share={saved.share}
              label={`${Math.round(saved.share * 100)}% of what Jane found`}
            />
          </span>
          <span className="text-xs font-semibold tracking-wider">
            {open ? "[LESS]" : "[WHERE IT CAME FROM]"}
          </span>
        </button>
      ) : (
        <>
          {/* Nothing saved yet: what Jane found is the report's total, one tap away. */}
          <Link
            prefetch={false}
            href="/report"
            className="text-sm font-medium text-zinc-600 after:absolute after:inset-0 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            {saved.label}
          </Link>
          <p data-hub-number="saved" className="text-2xl font-semibold tracking-tight tabular-nums">
            {number}
          </p>
        </>
      )}
      {savedSoFar && (
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
      )}
      {planItems > 0 && (
        <button
          ref={planButton}
          type="button"
          aria-expanded={showPlan}
          aria-controls="saved-plan"
          aria-haspopup="dialog"
          data-saved-plan=""
          onClick={() => setShowPlan((o) => !o)}
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
    </div>
  );
}

// The marching dotted line from the tile to the chat's message box, over the page; it fades out
// after a few seconds (no march with reduced motion).
function ChatLine({
  from,
  to,
  fading,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  fading: boolean;
}) {
  const sideways = Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
  const d = sideways
    ? `M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}`
    : `M${from.x},${from.y} C${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2} ${to.x},${to.y}`;
  return (
    <svg
      aria-hidden="true"
      data-chat-line=""
      className={`pointer-events-none fixed inset-0 z-[60] h-full w-full overflow-visible transition-opacity duration-500 motion-reduce:transition-none ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <MarchingPath d={d} />
    </svg>
  );
}
