"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { MOTION } from "@/config/motion";

// A reason as one sentence: some end with a full stop already (the practice scan's), some don't.
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// Floating cards (founder request; compact pop-ups, docs/design/home-hub.md): suggestions, or
// the options of one choice, as a small card that pops up above the chat's message box (or at
// the bottom of the hub on Home) and never covers more than about a third of the screen. Shut,
// it is an icon, a headline of a few words with one number, Yes and Not now, and the edges of
// the cards waiting behind it with a "+2". The chevron opens why, the figures, how sure Jane is
// and what Yes does, in place; they are on the page already, so it opens at once.
//
// Yes slides the card off to the right, Not now to the left, and the next one rises from the
// stack in the same frame (the e2e test holds it to 100 ms); the server work follows in the
// background (the handlers are called, never waited for). A swipe on a phone and the arrow
// keys on a computer move between the waiting cards; Escape is Not now. Every movement is a
// spring of about 250 ms, and a short fade only under reduced motion.
//
// The data shape is src/lib/floating-cards.ts; docs/spec.md ("Floating cards") says who feeds
// it. In "pick" mode the cards are the options of one choice: Yes picks that option and the
// whole set is done.

const SWIPE_PX = 50;
const LEAVE_MS = MOTION.slowMs;
const SPRING = MOTION.spring;
const BUTTON = "inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold";
const PRIMARY = `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`;
const SECONDARY = `${BUTTON} border border-zinc-400 bg-white hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:bg-zinc-900`;

export type CardAnswer = "yes" | "not_now" | "never";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The details open and shut in place by animating their height (Web Animations API) from
// what they measure. Shut, they are hidden: out of the tab order and the accessibility tree.
function Expanding({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Stays shown while it shuts, so the shutting can be seen.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  // With reduced motion there is nothing to watch: it shuts at once.
  if (!open && shown && reducedMotion()) setShown(false);
  const before = useRef(open);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || before.current === open) return;
    before.current = open;
    if (reducedMotion() || typeof el.animate !== "function") return;
    if (open) {
      el.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${el.scrollHeight}px`, opacity: 1 },
        ],
        { duration: MOTION.slowMs, easing: SPRING },
      );
    } else {
      const shut = el.animate(
        [
          { height: `${el.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: MOTION.baseMs, easing: MOTION.standard },
      );
      shut.onfinish = () => setShown(false);
    }
  }, [open]);
  return (
    <div ref={box} id={id} hidden={!open && !shown} className="overflow-hidden">
      {children}
    </div>
  );
}

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
  // Called at once when a card is answered (with the choice, when one of a card's other
  // choices was taken); the caller does the server work behind it.
  onAnswer: (id: string, answer: CardAnswer, choice?: string) => void;
  // A third, quieter choice inside the details ("Don't suggest this again"); omit for none.
  neverLabel?: string;
  // Page links to show inside a card's details, by card id.
  links?: Record<string, { label: string; href: string }[]>;
}) {
  const [state, setState] = useState(initialState);
  // Cards that just left, kept for the length of their exit slide, and which way they went.
  const [leaving, setLeaving] = useState<(FloatingCardData & { way: "yes" | "no" })[]>([]);
  const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = currentCard(cards, state);
  const left = waiting(cards, state);
  const open = current !== null && detailsOpen === current.id;
  // Cards waiting behind the one showing, drawn as edges under it.
  const behind = Math.max(0, left.length - 1);

  function respond(card: FloatingCardData, how: CardAnswer, choice?: string) {
    // The set first, so the next card is on screen in the same frame; then the caller's work.
    const departing = mode === "pick" ? left : [card];
    const way: "yes" | "no" = how === "yes" ? "yes" : "no";
    setLeaving((now) => [
      ...now,
      ...departing.filter((d) => !now.some((n) => n.id === d.id)).map((d) => ({ ...d, way })),
    ]);
    setState((s) => answer(cards, s, mode, card.id));
    setDetailsOpen(null);
    onAnswer(card.id, how, choice);
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
  });

  if (!current && leaving.length === 0) return null;
  const accent =
    mode === "pick"
      ? "border-emerald-700 bg-white dark:bg-zinc-950"
      : // Jane's own cards: inverted, so they never look like an answer.
        "invert-scope border-2 border-zinc-500";

  return (
    <section
      aria-label={label}
      data-floating-cards={mode}
      className="floating-cards pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
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
        {/* The cards waiting behind, as edges under this one. */}
        {current &&
          [1, 2].slice(0, Math.min(2, behind)).map((n) => (
            <span
              key={`edge-${n}`}
              aria-hidden="true"
              className={`floating-card-edge absolute inset-x-0 bottom-0 h-full border border-l-4 ${accent} shadow-sm`}
              style={{
                transform: `translateY(${n * 6}px) scaleX(${1 - n * 0.04})`,
                opacity: 1 - n * 0.25,
              }}
            />
          ))}
        {leaving.map((card) => (
          <article
            key={`leaving-${card.id}`}
            aria-hidden="true"
            data-card-state="leaving"
            className={`${card.way === "yes" ? "floating-card-out-yes" : "floating-card-out"} pointer-events-none absolute inset-x-0 bottom-0 flex items-start gap-2 border border-l-4 p-3 shadow-lg ${accent}`}
          >
            <h3 className="text-sm font-semibold">{card.headline}</h3>
          </article>
        ))}
        {current && (
          <article
            key={current.id}
            aria-label={current.headline}
            data-card-state="showing"
            className={`floating-card-in pointer-events-auto relative flex flex-col border border-l-4 shadow-lg ${accent}`}
          >
            <div className="flex items-start gap-2 pt-3 pl-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 shrink-0 text-xs font-semibold tracking-wider ${mode === "pick" ? "text-emerald-700" : ""}`}
              >
                {mode === "pick" ? "◆" : "[JANE]"}
              </span>
              <div className="min-w-0 flex-1">
                {current.badge && (
                  <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                    {current.badge}
                  </p>
                )}
                <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
                  {current.headline}
                </h3>
                {current.summary && (
                  <p className="text-xs text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
                    {current.summary}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="More details"
                aria-expanded={open}
                aria-controls={`details-${current.id}`}
                onClick={() => setDetailsOpen((o) => (o === current.id ? null : current.id))}
                className="-mt-2 inline-flex size-11 shrink-0 items-center justify-center text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`size-5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {/* X puts it off, as Not now does. */}
              <button
                type="button"
                aria-label="Close card"
                onClick={() => respond(current, "not_now")}
                className="-mt-2 -ml-2 inline-flex size-11 shrink-0 items-center justify-center text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  ×
                </span>
              </button>
            </div>
            {/* Already here, only hidden: opening it is a toggle, not a fetch. */}
            <Expanding id={`details-${current.id}`} open={open}>
              <div className="mx-3 mt-2 flex max-h-[22vh] flex-col gap-2 overflow-y-auto border-t border-zinc-300 pt-2 text-sm dark:border-zinc-700">
                {current.details.about && (
                  <p className="whitespace-pre-line">{current.details.about}</p>
                )}
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
                    <span className="font-medium">What Yes does:</span>{" "}
                    {current.details.whatYesDoes}
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
                {current.choices && current.choices.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {current.choices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => respond(current, "yes", c.id)}
                        className={SECONDARY}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {neverLabel && mode === "queue" && !current.noNever && (
                  <button
                    type="button"
                    onClick={() => respond(current, "never")}
                    className="inline-flex min-h-11 items-center self-start text-sm text-zinc-700 underline dark:text-zinc-300"
                  >
                    {neverLabel}
                  </button>
                )}
              </div>
            </Expanding>
            <div className="flex items-center gap-2 p-3">
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
              <p
                aria-live="polite"
                className={
                  mode === "pick"
                    ? "ml-auto text-xs text-zinc-600 tabular-nums dark:text-zinc-400"
                    : "sr-only"
                }
              >
                {counter(cards, state, mode)}
              </p>
              {mode === "queue" && behind > 0 && (
                <span
                  aria-hidden="true"
                  className="ml-auto text-xs font-semibold text-zinc-600 tabular-nums dark:text-zinc-400"
                >
                  +{behind}
                </span>
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
