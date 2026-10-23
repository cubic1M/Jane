"use client";

import { useEffect, useRef, useState } from "react";
import {
  answer,
  counter,
  currentCard,
  initialState,
  move,
  waiting,
  type CardMode,
  type FloatingCardData,
} from "@/lib/floating-cards";

// A reason as one sentence: some end with a full stop already (the practice scan's), some don't.
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// Floating cards over the page (founder request): suggestions, or the options of one choice,
// one card at a time, above the content and not in it. Yes, Not now or the ✕ takes the card
// away at once with a short slide, and the next slides in; the server work follows in the
// background (the handlers are called, never waited for). A swipe on a phone and the arrow
// keys on a desktop move between the waiting cards. "More details" opens the full reasoning,
// which is already on the page with the card, so it opens instantly.
//
// The data shape is src/lib/floating-cards.ts; docs/spec.md ("Floating cards") says who feeds
// it. In "pick" mode the cards are the options of one choice: Yes picks that option and the
// whole set is done.

const SWIPE_PX = 50;
const LEAVE_MS = 220;
const BUTTON = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold";
const PRIMARY = `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`;
const SECONDARY = `${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`;

export type CardAnswer = "yes" | "not_now" | "never";

export function FloatingCards({
  cards,
  mode = "queue",
  label,
  onAnswer,
  neverLabel,
  links,
}: {
  cards: FloatingCardData[];
  mode?: CardMode;
  // The overlay's accessible name ("Suggestions for you").
  label: string;
  // Called at once when a card is answered; the caller does the server work behind it.
  onAnswer: (id: string, answer: CardAnswer) => void;
  // A third, quieter choice inside More details ("Don't suggest this again"); omit for none.
  neverLabel?: string;
  // Page links to show inside a card's More details, by card id.
  links?: Record<string, { label: string; href: string }[]>;
}) {
  const [state, setState] = useState(initialState);
  // Cards that just left, kept for the length of their exit slide.
  const [leaving, setLeaving] = useState<FloatingCardData[]>([]);
  const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = currentCard(cards, state);
  const left = waiting(cards, state);

  function respond(card: FloatingCardData, how: CardAnswer) {
    // The set first, so the next card is on screen in the same frame; then the caller's work.
    const departing = mode === "pick" ? left : [card];
    setLeaving((now) => [...now, ...departing.filter((d) => !now.some((n) => n.id === d.id))]);
    setState((s) => answer(cards, s, mode, card.id));
    setDetailsOpen(null);
    onAnswer(card.id, how);
    window.setTimeout(
      () => setLeaving((now) => now.filter((n) => !departing.some((d) => d.id === n.id))),
      LEAVE_MS,
    );
  }

  // Arrow keys move between cards unless someone is typing; Escape puts the card off.
  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "ArrowRight") setState((s) => move(cards, s, 1));
      else if (event.key === "ArrowLeft") setState((s) => move(cards, s, -1));
      else if (event.key === "Escape") respond(current, "not_now");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // respond closes over the set it needs; it is rebuilt each render, so listen again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  if (!current && leaving.length === 0) return null;

  return (
    <section
      aria-label={label}
      data-floating-cards={mode}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(t.clientY - start.y) * 1.5) {
          setState((s) => move(cards, s, dx < 0 ? 1 : -1));
        }
      }}
    >
      <div className="relative w-full max-w-md">
        {leaving.map((card) => (
          <article
            key={`leaving-${card.id}`}
            aria-hidden="true"
            data-card-state="leaving"
            className="floating-card-out pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 border-2 border-emerald-700 bg-white p-3 shadow-lg dark:bg-zinc-950"
          >
            <h3 className="text-base font-semibold">{card.headline}</h3>
          </article>
        ))}
        {current && (
          <article
            key={current.id}
            aria-label={current.headline}
            data-card-state="showing"
            className="floating-card-in pointer-events-auto flex flex-col gap-2 border-2 border-emerald-700 bg-white p-3 shadow-lg dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2 text-xs">
                <p aria-live="polite" className="tabular-nums text-zinc-600 dark:text-zinc-400">
                  {counter(cards, state, mode)}
                </p>
                {current.badge && (
                  <p className="font-semibold text-emerald-800 dark:text-emerald-400">
                    {current.badge}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Not now"
                onClick={() => respond(current, "not_now")}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-lg text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{current.headline}</h3>
            {current.summary && (
              <p className="text-sm text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
                {current.summary}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => respond(current, "yes")} className={PRIMARY}>
                {current.yesLabel}
              </button>
              <button
                type="button"
                onClick={() => respond(current, "not_now")}
                className={SECONDARY}
              >
                {current.notNowLabel ?? "Not now"}
              </button>
              <button
                type="button"
                aria-expanded={detailsOpen === current.id}
                aria-controls={`details-${current.id}`}
                onClick={() => setDetailsOpen((open) => (open === current.id ? null : current.id))}
                className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-emerald-700 hover:underline"
              >
                More details
              </button>
            </div>
            {/* Already here, only hidden: opening it is a toggle, not a fetch. */}
            <div
              id={`details-${current.id}`}
              hidden={detailsOpen !== current.id}
              className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto border-t border-zinc-300 pt-2 text-sm dark:border-zinc-700"
            >
              {current.details.why && (
                <p>
                  <span className="font-medium">Why you:</span> {current.details.why}
                </p>
              )}
              {current.details.figures && current.details.figures.length > 0 && (
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {current.details.figures.map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="text-zinc-700 dark:text-zinc-300">{f.label}</dt>
                      <dd className="text-right font-medium tabular-nums">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {current.details.confidence && (
                <p>
                  <span className="font-medium">{current.details.confidence.percent}% sure:</span>{" "}
                  {sentence(current.details.confidence.reason)}
                </p>
              )}
              {current.details.whatYesDoes && (
                <p>
                  <span className="font-medium">What Yes does:</span> {current.details.whatYesDoes}
                </p>
              )}
              {current.details.notes?.map((note) => (
                <p key={note} className="text-xs text-zinc-600 dark:text-zinc-400">
                  {note}
                </p>
              ))}
              {(links?.[current.id] ?? []).map((link) => (
                <a
                  key={link.href + link.label}
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700 hover:underline"
                >
                  {link.label} ›
                </a>
              ))}
              {neverLabel && mode === "queue" && (
                <button
                  type="button"
                  onClick={() => respond(current, "never")}
                  className="inline-flex min-h-11 items-center self-start text-sm text-zinc-700 underline dark:text-zinc-300"
                >
                  {neverLabel}
                </button>
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
