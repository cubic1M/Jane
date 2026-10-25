"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  answer,
  restore,
  counter,
  currentCard,
  initialState,
  move,
  paragraphs,
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
const BUTTON = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold";
const PRIMARY = `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`;
const SECONDARY = `${BUTTON} border border-zinc-400 bg-white hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:bg-zinc-900`;

// The card's buttons never run past it: a label longer than the card wraps inside its button.
const COMPACT = "max-w-full text-left";
const STEP =
  "inline-flex min-h-11 items-center px-1 text-xs font-semibold text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50";

export type CardAnswer = "yes" | "not_now" | "never";

// A small phone: there, Home's cards start folded into one line at the bottom (QA round 6: the
// card covered the net-worth figure on a 375 x 812 phone), and a tap opens them.
const PHONE = "(max-width: 639px)";
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const usePhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

// The dock's header line (founder read the old arrows beside the choices as "more choices"):
// "JANE · 2 of 5 suggestions", and the steps between them, apart from any card's buttons. The
// arrow keys step only while it has focus.
function DockHeader({
  position,
  total,
  onStep,
}: {
  position: number;
  total: number;
  onStep: (by: 1 | -1) => void;
}) {
  return (
    <div
      data-dock-header=""
      role="group"
      aria-label="Jane's suggestions"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onStep(1);
        else if (e.key === "ArrowLeft") onStep(-1);
        else return;
        e.preventDefault();
      }}
      className="mb-2 flex min-h-11 items-center gap-2 text-xs font-semibold tracking-wider"
    >
      <p>
        JANE · {position} of {total} {total === 1 ? "suggestion" : "suggestions"}
      </p>
      {total > 1 && (
        // Named by their words (accessibility: the name holds what's shown).
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => onStep(-1)} className={STEP}>
            <span aria-hidden="true">[‹&nbsp;</span>previous
            <span className="sr-only"> suggestion</span>
            <span aria-hidden="true">]</span>
          </button>
          <button type="button" onClick={() => onStep(1)} className={STEP}>
            <span aria-hidden="true">[</span>next<span className="sr-only"> suggestion</span>
            <span aria-hidden="true">&nbsp;›]</span>
          </button>
        </span>
      )}
    </div>
  );
}

// Details as paragraphs with room between them, lists as lists (src/lib/floating-cards.ts).
function Prose({ text, lead }: { text: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {paragraphs(text).map((block, i) =>
        block.kind === "list" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {i === 0 && lead && <span className="font-medium">{lead} </span>}
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

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
  onRevert,
  onSettle,
  neverLabel,
  links,
  foldOnPhone = false,
  docked = false,
}: {
  cards: FloatingCardData[];
  mode?: CardMode;
  // The overlay's accessible name ("Suggestions for you").
  label: string;
  // Called at once when a card is answered (with the choice, when one of a card's other
  // choices was taken); the caller does the server work behind it.
  onAnswer: (id: string, answer: CardAnswer, choice?: string) => void;
  // Revert on a chosen revertable card (the caller undoes the choice on the server).
  onRevert?: (id: string) => void;
  // Done on a chosen card: it settles into the history (the caller tells the server).
  onSettle?: (id: string) => void;
  // A third, quieter choice inside the details ("Don't suggest this again"); omit for none.
  neverLabel?: string;
  // Page links to show inside a card's details, by card id.
  links?: Record<string, { label: string; href: string }[]>;
  // Start folded into one line at the bottom on a small phone, until it's tapped (Home, where
  // the cards would cover the net worth).
  foldOnPhone?: boolean;
  // In the dock above the side chat (src/components/side-chat/card-dock.tsx): in the flow
  // there, not floating; a little bigger, with arrows between the cards.
  docked?: boolean;
}) {
  const [state, setState] = useState(initialState);
  // A revertable card that was just chosen (founder, 2026-10-25): it stays on screen with its
  // choices greyed and the chosen one marked, Revert and Done, while the server catches up;
  // after Revert (chosen null) it's open again at once.
  const [held, setHeld] = useState<{ card: FloatingCardData; chosen: string | null } | null>(null);
  // Cards that just left, kept for the length of their exit slide, and which way they went.
  const [leaving, setLeaving] = useState<(FloatingCardData & { way: "yes" | "no" })[]>([]);
  const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
  // Which way the last step went, for the next card's slide (none when one is answered).
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const phone = usePhone();
  const [unfolded, setUnfolded] = useState(false);
  const current = held?.card ?? currentCard(cards, state);
  const left = waiting(cards, state);
  const open = current !== null && detailsOpen === current.id;
  // Cards waiting behind the one showing, drawn as edges under it.
  const behind = Math.max(0, left.length - 1);
  const folded = foldOnPhone && phone && !unfolded && current !== null;

  function respond(card: FloatingCardData, how: CardAnswer, choice?: string) {
    if (how === "yes" && card.revertable) {
      // Chosen: the card stays, marked, in the same frame; the server work follows.
      const label = choice
        ? (card.choices?.find((c) => c.id === choice)?.label ?? card.yesLabel)
        : card.yesLabel;
      setHeld({ card, chosen: label });
      setState((s) => answer(cards, s, mode, card.id));
      setDetailsOpen(null);
      onAnswer(card.id, how, choice);
      return;
    }
    setHeld(null);
    // The set first, so the next card is on screen in the same frame; then the caller's work.
    const departing = mode === "pick" ? left : [card];
    const way: "yes" | "no" = how === "yes" ? "yes" : "no";
    setLeaving((now) => [
      ...now,
      ...departing.filter((d) => !now.some((n) => n.id === d.id)).map((d) => ({ ...d, way })),
    ]);
    setState((s) => answer(cards, s, mode, card.id));
    setDetailsOpen(null);
    setSlide(null);
    onAnswer(card.id, how, choice);
    window.setTimeout(
      () => setLeaving((now) => now.filter((n) => !departing.some((d) => d.id === n.id))),
      LEAVE_MS,
    );
  }

  // How tall the floating stack is, so the page scrolls things into view above it (the chat's
  // message box adds it to its scroll padding).
  const section = useRef<HTMLElement>(null);
  const floating = !docked && !folded && current !== null;
  useEffect(() => {
    const el = section.current;
    const root = document.documentElement;
    if (!floating || !el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() =>
      // Hidden (the dock has the cards), it is 0 tall.
      root.style.setProperty("--floating-cards-h", `${Math.round(el.offsetHeight)}px`),
    );
    watch.observe(el);
    return () => {
      watch.disconnect();
      root.style.removeProperty("--floating-cards-h");
    };
  }, [floating]);

  // To the next or previous card: it slides in from that side, and opens as this one was
  // (founder: switching never "collapses" the card), the height following it.
  function step(by: 1 | -1) {
    setHeld(null);
    const next = move(cards, state, by);
    const to = currentCard(cards, next);
    setState(next);
    setSlide(by > 0 ? "next" : "prev");
    if (open && to) setDetailsOpen(to.id);
  }

  // Arrow keys move between cards unless someone is typing or is on one of the card's own
  // buttons; Escape puts the card off.
  useEffect(() => {
    // Docked, the dock's header line has the arrows (its keys work only there).
    if (!current || folded || docked) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (target?.closest?.("[data-card-actions]")) return;
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
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

  if (folded) {
    return (
      <section
        aria-label={label}
        data-floating-cards={mode}
        className="floating-cards floating-cards-folded pointer-events-none fixed inset-x-0 z-40 flex px-3"
      >
        <button
          type="button"
          data-card-state="folded"
          aria-expanded={false}
          onClick={() => setUnfolded(true)}
          className="floating-card-in invert-scope pointer-events-auto inline-flex min-h-11 items-center gap-2 border-2 border-zinc-500 px-3 text-sm font-semibold shadow-lg"
        >
          <span aria-hidden="true" className="text-xs tracking-wider">
            [JANE]
          </span>
          {left.length} for you
          <span aria-hidden="true">▲</span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      data-floating-cards={mode}
      ref={section}
      data-card-dock={docked ? "" : undefined}
      className={
        docked
          ? "flex w-full flex-col px-3 pt-3 pb-4"
          : "floating-cards pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      }
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
          step(dx < 0 ? 1 : -1);
        }
      }}
    >
      {docked && current && (
        <DockHeader
          position={Math.max(1, left.findIndex((c) => c.id === current.id) + 1)}
          total={left.length}
          onStep={step}
        />
      )}
      <div
        className={`relative w-full ${
          docked
            ? ""
            : // Wider opened, or with choices, so more of its buttons fit on one line.
              `floating-card-width ${open || (current?.choices?.length ?? 0) > 0 ? "max-w-2xl" : "max-w-md"}`
        }`}
      >
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
            className={`${slide ? `floating-card-slide-${slide}` : "floating-card-in"} pointer-events-auto relative flex flex-col border border-l-4 shadow-lg ${accent}`}
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
                <h3
                  className={`${docked ? "text-base" : "text-sm"} font-semibold [overflow-wrap:anywhere]`}
                >
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
              <div
                className={`mx-3 mt-2 flex flex-col gap-3 overflow-y-auto overscroll-contain border-t border-zinc-300 pt-3 pb-1 text-sm leading-relaxed tabular-nums dark:border-zinc-700 ${
                  docked ? "max-h-[60vh]" : "max-h-[55vh]"
                }`}
              >
                {current.details.about && <Prose text={current.details.about} />}
                {current.details.why && <Prose text={current.details.why} lead="Why you:" />}
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
                {current.details.whatYesDoes && (
                  <Prose text={current.details.whatYesDoes} lead="What Yes does:" />
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
                {neverLabel && mode === "queue" && !current.noNever && (
                  <button
                    type="button"
                    onClick={() => respond(current, "never")}
                    className="inline-flex min-h-11 items-center self-start text-sm text-zinc-700 underline dark:text-zinc-300"
                  >
                    {neverLabel}
                  </button>
                )}
                {/* How sure Jane is, last and on its own line. */}
                {current.details.confidence && (
                  <p data-card-confidence="">
                    <span className="font-medium">{current.details.confidence.percent}% sure:</span>{" "}
                    {sentence(current.details.confidence.reason)}
                  </p>
                )}
              </div>
            </Expanding>
            <div className="flex flex-wrap items-center gap-2 p-3">
              {/* Every choice always in view, labels whole (founder: "not all the choices are
                  shown"): one line when they fit (compact buttons), wrapping onto another
                  rather than ever being cut off or scrolled out of sight. */}
              {(held?.chosen && held.card.id === current.id) ||
              (current.chosen && !(held?.card.id === current.id && held.chosen === null)) ? (
                <ChosenActions
                  card={current}
                  chosen={
                    held?.card.id === current.id && held.chosen ? held.chosen : current.chosen!
                  }
                  onRevert={
                    onRevert
                      ? () => {
                          onRevert(current.id);
                          setState((s) => restore(cards, s, current.id));
                          setHeld({ card: current, chosen: null });
                        }
                      : undefined
                  }
                  onDone={() => {
                    setHeld(null);
                    setState((s) => answer(cards, s, mode, current.id));
                    onSettle?.(current.id);
                  }}
                />
              ) : (
                <div data-card-actions="" className="flex min-w-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => respond(current, "yes")}
                    className={`${PRIMARY} ${COMPACT}`}
                  >
                    {current.yesLabel}
                  </button>
                  {current.choices?.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => respond(current, "yes", c.id)}
                      className={`${SECONDARY} ${COMPACT}`}
                    >
                      {c.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => respond(current, "not_now")}
                    className={`${SECONDARY} ${COMPACT}`}
                  >
                    {current.notNowLabel ?? "Not now"}
                  </button>
                </div>
              )}
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
              {mode === "queue" && !docked && behind > 0 && (
                <span
                  aria-hidden="true"
                  className="ml-auto pl-1 text-xs font-semibold text-zinc-600 tabular-nums dark:text-zinc-400"
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

// A chosen pick-one card (founder, 2026-10-25): every choice still in view, the chosen one
// inverted and marked, the others greyed and off; Revert takes it back, Done moves on.
function ChosenActions({
  card,
  chosen,
  onRevert,
  onDone,
}: {
  card: FloatingCardData;
  chosen: string;
  onRevert?: () => void;
  onDone: () => void;
}) {
  const labels = [card.yesLabel, ...(card.choices ?? []).map((c) => c.label)];
  return (
    <div data-card-actions="" data-card-chosen="" className="flex min-w-0 flex-wrap gap-2">
      {labels.map((label) =>
        label === chosen ? (
          <button
            key={label}
            type="button"
            disabled
            aria-pressed="true"
            className={`${COMPACT} inline-flex items-center gap-1 border-2 border-current bg-zinc-950 px-3 font-semibold text-white dark:bg-white dark:text-zinc-950`}
          >
            {label} <span aria-hidden="true">[✓ chosen]</span>
            <span className="sr-only">, chosen</span>
          </button>
        ) : (
          <button
            key={label}
            type="button"
            disabled
            aria-pressed="false"
            className={`${SECONDARY} ${COMPACT} opacity-40`}
          >
            {label}
          </button>
        ),
      )}
      {onRevert && (
        <button type="button" onClick={onRevert} className={`${SECONDARY} ${COMPACT}`}>
          <span aria-hidden="true">↶ </span>Revert
        </button>
      )}
      <button type="button" onClick={onDone} className={`${SECONDARY} ${COMPACT}`}>
        Done
      </button>
    </div>
  );
}
