"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SafeHero } from "@/lib/hub/view";
import { formatWholeDollars } from "@/lib/money";
import { Blinded, ShowValue } from "./blinded";
import { CalcLines, CalcPopup } from "./calc-popup";
import { StackBar } from "./charts";
import { MarchingPath } from "@/components/marching-path";

// Safe to spend (founder: "When you click safe to spend till… it should expand first having a
// summary on why that number is what it is. On the bottom, that box should suggest smth like what
// are u aiming to spend and it would link you to the chat on the right with a dotted line"). It
// opens in place, its height animated (.hub-open, none with reduced motion). Since the home
// redesign (11-12) it's on Spending & bills; money found is Home's "Jane found"
// (src/components/hub/jane-found.tsx), and saved so far is /saved.

const CARD =
  "group relative flex min-w-0 flex-col gap-2 border border-zinc-300 bg-white p-4 hover:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-100";
const TOGGLE = "flex w-full min-w-0 flex-col items-start gap-2 text-left";
const LABEL =
  "text-sm font-medium text-zinc-600 group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-zinc-50";
const LINK = "self-start text-sm font-medium underline-offset-2 hover:underline";
const NUMBER_ROW = "flex flex-wrap items-center gap-x-3";

// Whole dollars, rounded (it said $376/yr where the import chip said $377/yr for $376.80).
const dollars = formatWholeDollars;

// What goes in the chat's message box: the person types the amount and sends it themselves. The
// hint shows greyed after the cursor until they type, and is never sent (founder: "there should be
// after 'I am aiming to spend' with a clue, like '[dollar amount]'").
export const AIM_PROMPT = "I'm aiming to spend $";
export const AIM_HINT = "[amount] on [what]";

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
  const [shown, setShown] = useState(false);
  // Asking why this number is asking to see it.
  const toggleOpen = () => {
    if (!open) setShown(true);
    setOpen(!open);
  };
  const toggleShown = () => {
    if (shown) {
      setOpen(false);
      setShowHow(false);
    }
    setShown(!shown);
  };
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
    <div ref={tile} data-hub-tile="safe" className={CARD}>
      <span className={LABEL}>{safe.label}</span>
      <div className={NUMBER_ROW}>
        <span
          data-hub-number="safe"
          className={`block text-2xl font-semibold tracking-tight tabular-nums ${safe.short ? "font-bold" : ""}`}
        >
          {/* Being short still says so while the amount is hidden. */}
          {safe.short && "Short "}
          {shown ? dollars(safe.cents) : <Blinded />}
        </span>
        <ShowValue shown={shown} what={safe.label.toLowerCase()} onToggle={toggleShown} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="safe-why"
        aria-label={`${safe.label}: why this number`}
        onClick={toggleOpen}
        className={TOGGLE}
      >
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
