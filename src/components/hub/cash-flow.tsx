"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCents } from "@/lib/money";
import type { CashEvent, CashFlowView } from "@/lib/hub/view";

// The hub's cash-flow strip (docs/design/home-hub.md): the next 30 days on one line, paydays
// above it, bills below it (sized by amount against the biggest), other dates on it. Hover,
// focus or tap shows what and how much, with a link to its page. One tab stop: the arrow keys
// move along the line.

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const KIND_WORD: Record<CashEvent["kind"], string> = {
  bill: "bill",
  pay: "payday",
  deadline: "date",
};

const describe = (e: CashEvent) =>
  [
    e.label,
    KIND_WORD[e.kind],
    shortDate(e.date),
    e.amountCents !== null ? formatCents(e.amountCents) : null,
  ]
    .filter(Boolean)
    .join(", ");

export function CashFlowStrip({ view, endDate }: { view: CashFlowView; endDate: string }) {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const events = view.events;
  // Events on the same day stack away from the line.
  const stack = new Map<string, number>();
  const offsets = events.map((e) => {
    const k = `${e.kind}|${e.day}`;
    const n = stack.get(k) ?? 0;
    stack.set(k, n + 1);
    return n;
  });
  const bills = events.filter((e) => e.kind === "bill").length;
  const pays = events.filter((e) => e.kind === "pay").length;
  const at = (day: number) => `${(day / view.days) * 100}%`;
  const open = shown === null ? null : events[shown];

  const move = (to: number) => {
    const i = Math.max(0, Math.min(events.length - 1, to));
    setActive(i);
    setShown(i);
    document.getElementById(`cash-event-${i}`)?.focus();
  };

  return (
    <section aria-labelledby="cash-flow-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="cash-flow-heading" className="text-base font-semibold">
          Next 30 days
        </h2>
        <p aria-hidden className="flex gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          <span>
            <span className="text-emerald-700">▲</span> pay
          </span>
          <span>
            <span className="text-zinc-700 dark:text-zinc-300">▼</span> bill
          </span>
          <span>
            <span className="text-amber-700">◆</span> date
          </span>
        </p>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing due in the next month.</p>
      ) : (
        <div
          role="group"
          aria-label={`Next 30 days: ${bills} ${bills === 1 ? "bill" : "bills"}, ${pays} ${pays === 1 ? "payday" : "paydays"}`}
          className="relative h-28 select-none"
          onMouseLeave={() => setShown(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") move(active + 1);
            else if (event.key === "ArrowLeft") move(active - 1);
            else if (event.key === "Home") move(0);
            else if (event.key === "End") move(events.length - 1);
            else if (event.key === "Escape") setShown(null);
            else return;
            event.preventDefault();
          }}
        >
          {/* The line, with today at the left. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-px bg-zinc-400 dark:bg-zinc-600"
          />
          <span
            aria-hidden
            className="absolute top-1/2 left-0 size-2 -translate-y-1/2 bg-zinc-900 dark:bg-zinc-100"
          />
          {events.map((e, i) => {
            const size = e.kind === "deadline" ? 10 : Math.round(9 + e.weight * 11);
            const away = 6 + offsets[i] * (size + 3);
            const pos =
              e.kind === "pay"
                ? { bottom: `calc(50% + ${away}px)` }
                : e.kind === "bill"
                  ? { top: `calc(50% + ${away}px)` }
                  : { top: `calc(50% - ${size / 2}px)` };
            return (
              <button
                key={e.key}
                id={`cash-event-${i}`}
                type="button"
                tabIndex={i === active ? 0 : -1}
                aria-label={describe(e)}
                aria-describedby={shown === i ? "cash-tip" : undefined}
                onMouseEnter={() => setShown(i)}
                onFocus={() => {
                  setActive(i);
                  setShown(i);
                }}
                onClick={() => setShown(shown === i ? null : i)}
                data-kind={e.kind}
                className="hub-pop absolute flex -translate-x-1/2 items-center justify-center p-1 outline-offset-2"
                style={{ left: at(e.day), ...pos, animationDelay: `${Math.min(i, 20) * 20}ms` }}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 10 10"
                  width={size}
                  height={size}
                  className="overflow-visible"
                >
                  {e.kind === "pay" && (
                    <path
                      d="M5 0 L10 10 L0 10 Z"
                      className="fill-emerald-700 dark:fill-emerald-400"
                    />
                  )}
                  {e.kind === "bill" && (
                    <path d="M0 0 L10 0 L5 10 Z" className="fill-zinc-700 dark:fill-zinc-300" />
                  )}
                  {e.kind === "deadline" && (
                    <path
                      d="M5 0 L10 5 L5 10 L0 5 Z"
                      className="fill-amber-600 dark:fill-amber-400"
                    />
                  )}
                </svg>
              </button>
            );
          })}
          {open && shown !== null && (
            <div
              id="cash-tip"
              role="tooltip"
              className="hub-pop pointer-events-auto absolute z-10 w-44 border border-zinc-300 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              style={{
                left: `clamp(0px, calc(${at(open.day)} - 5.5rem), calc(100% - 11rem))`,
                ...(open.kind === "pay"
                  ? { top: "calc(50% + 0.75rem)" }
                  : { bottom: "calc(50% + 0.75rem)" }),
              }}
            >
              <p className="font-semibold [overflow-wrap:anywhere]">{open.label}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {shortDate(open.date)}
                {open.amountCents !== null && (
                  <span className="font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                    {" "}
                    · {open.kind === "pay" ? "+" : ""}
                    {formatCents(open.amountCents)}
                  </span>
                )}
              </p>
              {open.href && (
                <Link href={open.href} className="font-medium text-emerald-700 hover:underline">
                  Open ›
                </Link>
              )}
            </div>
          )}
        </div>
      )}
      <div aria-hidden className="flex justify-between text-xs text-zinc-500">
        <span>Today</span>
        <span>{shortDate(endDate)}</span>
      </div>
    </section>
  );
}
