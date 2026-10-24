"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  changeOver,
  pointsIn,
  rangesFor,
  type RangeKey,
  type SeriesPoint,
} from "@/insights/net-worth-series";
import { daysToMark, type EventGroup, type NetWorthEvent } from "@/insights/net-worth-events";
import { formatCents } from "@/lib/money";

// The home hub's net worth chart (founder request; docs/design/home-hub.md): the person's net
// worth from their first day with Jane to today, as one clean line. A big number with the
// range's change under it (▲ or ▼ and a sign); the line in the page's text colour, with a
// dotted baseline at where the range started. Hover (computer), drag (phone) or the arrow
// keys scrub: the number and the date follow the point under the hairline, and letting go
// returns to today. Range chips under it: 1W 1M 3M 1Y ALL, only those the history is longer
// than, ALL first chosen. The line draws itself in when the range changes (not with reduced
// motion).

// The hero: the biggest thing on Home (founder: "the networth should be the biggest one, a big
// graph"), and taller again when expanded to show its events.
const H_WIDE = 260;
const H_NARROW = 190;
const H_EXPANDED_WIDE = 400;
const H_EXPANDED_NARROW = 300;
const PAD_Y = 14;
// A marker's hit area, in px: bigger than its dot.
const MARK = 24;

const RANGE_WORDS: Record<RangeKey, string> = {
  "1W": "Past week",
  "1M": "Past month",
  "3M": "Past 3 months",
  "1Y": "Past year",
  ALL: "Since you started",
};

const dollars = (cents: number) => formatCents(cents).replace(/\.\d\d$/, "");
const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${dollars(Math.abs(cents))}`;
const percent = (share: number) =>
  `${share >= 0 ? "+" : "−"}${(Math.abs(share) * 100).toFixed(Math.abs(share) < 0.1 ? 2 : 1)}%`;
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// What an event did, as its card says it: "+$3,000", or "$800 moved" for money moved between
// the person's own accounts.
const effect = (e: NetWorthEvent) =>
  e.cents !== 0 ? signed(e.cents) : e.moved ? `${dollars(e.moved)} moved` : "";

export function NetWorthChart({
  points,
  events = [],
}: {
  points: SeriesPoint[];
  // The days money moved because of something (src/lib/hub/net-worth-events.ts).
  events?: EventGroup[];
}) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [scrub, setScrub] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The marker whose card is open, by date.
  const [marked, setMarked] = useState<string | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  // A finger on the line (a drag scrubs until it lets go).
  const dragging = useRef(false);

  useLayoutEffect(() => {
    if (box.current) setWidth(box.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const today = points[points.length - 1];
  const ranges = rangesFor(points);
  const shown = pointsIn(points, ranges.includes(range) ? range : "ALL");
  const at = scrub === null ? shown.length - 1 : Math.min(scrub, shown.length - 1);
  const point = shown[at] ?? today;
  const move = changeOver(shown, at);

  if (!today) return null;
  const single = points.length < 2;

  const narrow = width < 480;
  const H = expanded ? (narrow ? H_EXPANDED_NARROW : H_EXPANDED_WIDE) : narrow ? H_NARROW : H_WIDE;
  // The days to mark: the biggest in the range on screen, placed on the line.
  const dayIndex = new Map(shown.map((p, i) => [p.date, i]));
  const marks = expanded
    ? daysToMark(events, shown[0]?.date ?? "").flatMap((g) => {
        const i = dayIndex.get(g.date);
        return i === undefined ? [] : [{ group: g, i }];
      })
    : [];
  const open = marks.find((m) => m.group.date === marked) ?? null;
  const values = shown.map((p) => p.cents);
  const hi0 = Math.max(...values);
  const lo0 = Math.min(...values);
  // A tiny move stays visible but isn't blown up into a cliff.
  const span = Math.max(hi0 - lo0, Math.abs(hi0) * 0.01, 100);
  const mid = (hi0 + lo0) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const x = (i: number) => (shown.length < 2 ? width : (i / (shown.length - 1)) * width);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2);
  // At most one vertex per pixel; the last point is always kept.
  const step = Math.max(1, Math.floor(shown.length / Math.max(1, width)));
  const path = shown
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % step === 0 || i === shown.length - 1)
    .map(({ p, i }, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`)
    .join(" ");

  const indexAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || shown.length < 2) return shown.length - 1;
    const share = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(share * (shown.length - 1));
  };

  // Monochrome (docs/design/area-pages.md): the line is the page's text colour; up and down
  // are ▲ and ▼ and a sign, never a colour.
  const stroke = "stroke-current";
  const arrow = (cents: number) => (cents >= 0 ? "▲" : "▼");

  return (
    <section
      aria-labelledby="net-worth-heading"
      data-net-worth-chart=""
      className="flex flex-col gap-2 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          id="net-worth-heading"
          href="/net-worth"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Net worth
        </Link>
        {!single && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((e) => !e);
              setMarked(null);
            }}
            className="inline-flex min-h-11 items-center text-xs font-semibold tracking-wider hover:underline"
          >
            {expanded ? "[CLOSE]" : "[EXPAND]"}
            <span className="sr-only">
              {expanded ? " the net worth chart" : " the net worth chart to see what moved it"}
            </span>
          </button>
        )}
      </div>
      <p
        data-hub-number="net-worth"
        className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
      >
        {dollars(point.cents)}
      </p>
      {single ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your line starts today. It grows each day from here.
        </p>
      ) : (
        <p data-net-worth-change="" className="text-sm tabular-nums">
          <span className="font-semibold">
            <span aria-hidden="true">{arrow(move.cents)} </span>
            {signed(move.cents)}
            {move.share !== null && ` (${percent(move.share)})`}
          </span>{" "}
          <span className="text-zinc-600 dark:text-zinc-400">
            {scrub === null
              ? RANGE_WORDS[ranges.includes(range) ? range : "ALL"]
              : longDate(point.date)}
          </span>
        </p>
      )}

      {!single && (
        <>
          <div className="relative">
            <div
              ref={box}
              // Scrubbing is choosing a day: a slider, its value the day and the net worth then.
              role="slider"
              tabIndex={0}
              aria-label={`Net worth, ${RANGE_WORDS[ranges.includes(range) ? range : "ALL"].toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={shown.length - 1}
              aria-valuenow={at}
              aria-valuetext={`${at === shown.length - 1 ? "Today" : longDate(point.date)}: ${dollars(point.cents)}`}
              className="relative -mx-1 cursor-crosshair touch-pan-y outline-offset-4 select-none"
              style={{ height: H }}
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") {
                  dragging.current = true;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Capture is a nicety: the drag still follows inside the chart.
                  }
                }
                setScrub(indexAt(e.clientX));
              }}
              onPointerMove={(e) => {
                if (e.pointerType === "mouse" || dragging.current) setScrub(indexAt(e.clientX));
              }}
              onPointerUp={(e) => {
                if (e.pointerType !== "mouse") {
                  dragging.current = false;
                  setScrub(null);
                }
              }}
              onPointerCancel={() => {
                dragging.current = false;
                setScrub(null);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setScrub(null);
              }}
              onBlur={() => setScrub(null)}
              onKeyDown={(e) => {
                const from = scrub ?? shown.length - 1;
                const jump = e.shiftKey ? 7 : 1;
                if (e.key === "ArrowLeft") setScrub(Math.max(0, from - jump));
                else if (e.key === "ArrowRight") {
                  const next = from + jump;
                  setScrub(next >= shown.length - 1 ? null : next);
                } else if (e.key === "Home") setScrub(0);
                else if (e.key === "End" || e.key === "Escape") setScrub(null);
                else return;
                e.preventDefault();
              }}
            >
              <svg
                aria-hidden="true"
                width={width}
                height={H}
                viewBox={`0 0 ${width} ${H}`}
                className="absolute inset-0 overflow-visible"
              >
                {/* Where the range started. */}
                <line
                  x1={0}
                  x2={width}
                  y1={y(shown[0].cents)}
                  y2={y(shown[0].cents)}
                  strokeWidth={1}
                  strokeDasharray="2 5"
                  className="stroke-zinc-400 dark:stroke-zinc-600"
                />
                <path
                  key={`${range}-${shown.length}`}
                  d={path}
                  pathLength={1}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={`nw-line ${stroke}`}
                />
                {scrub !== null && (
                  <>
                    <line
                      x1={x(at)}
                      x2={x(at)}
                      y1={0}
                      y2={H}
                      strokeWidth={1}
                      className="stroke-zinc-500 dark:stroke-zinc-400"
                    />
                    <circle
                      cx={x(at)}
                      cy={y(point.cents)}
                      r={4.5}
                      strokeWidth={2}
                      className={`fill-white dark:fill-zinc-950 ${stroke}`}
                    />
                  </>
                )}
                {scrub === null && (
                  <circle
                    cx={x(shown.length - 1)}
                    cy={y(today.cents)}
                    r={3.5}
                    className="fill-current"
                  />
                )}
              </svg>
            </div>
            {/* Expanded, the days money moved because of something: a dot on the line each, its
              card on hover, focus or tap. */}
            {marks.length > 0 && (
              <div className="pointer-events-none absolute inset-0 -mx-1">
                {marks.map(({ group, i }) => (
                  <button
                    key={group.date}
                    type="button"
                    data-net-worth-event={group.date}
                    aria-label={`${longDate(group.date)}: ${group.events
                      .map((e) => `${e.label} ${effect(e)}`)
                      .join("; ")}`}
                    aria-expanded={marked === group.date}
                    onMouseEnter={() => setMarked(group.date)}
                    onFocus={() => setMarked(group.date)}
                    onClick={() => setMarked((m) => (m === group.date ? null : group.date))}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setMarked(null);
                    }}
                    className="pointer-events-auto absolute flex items-center justify-center"
                    style={{
                      left: x(i) - MARK / 2,
                      top: y(shown[i].cents) - MARK / 2,
                      width: MARK,
                      height: MARK,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={`block size-2.5 border-2 border-current ${
                        marked === group.date ? "bg-current" : "bg-white dark:bg-zinc-950"
                      } ${group.events.length > 1 ? "outline outline-1 outline-offset-2 outline-current" : ""}`}
                    />
                  </button>
                ))}
                {open && (
                  <div
                    role="status"
                    data-net-worth-event-card=""
                    className="pointer-events-auto absolute z-10 flex w-60 flex-col gap-1 border-2 border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
                    style={{
                      left: Math.min(Math.max(0, x(open.i) - 120), Math.max(0, width - 240)),
                      top:
                        y(shown[open.i].cents) > H / 2
                          ? Math.max(
                              0,
                              y(shown[open.i].cents) - 16 - 28 * (open.group.events.length + 1),
                            )
                          : y(shown[open.i].cents) + 16,
                    }}
                  >
                    <p className="font-semibold tabular-nums">{longDate(open.group.date)}</p>
                    <ul className="flex flex-col gap-0.5">
                      {open.group.events.map((e, k) => (
                        <li key={k} className="flex items-baseline justify-between gap-2">
                          <Link href={e.href} className="min-w-0 truncate hover:underline">
                            {e.label}
                          </Link>
                          <span className="shrink-0 font-semibold tabular-nums">{effect(e)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div role="group" aria-label="Range" className="flex flex-wrap gap-1">
            {ranges.map((key) => {
              const on = key === (ranges.includes(range) ? range : "ALL");
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setRange(key);
                    setScrub(null);
                    setMarked(null);
                  }}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-sm font-semibold ${
                    on
                      ? "border-b-2 border-current"
                      : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {key}
                  <span className="sr-only">, {RANGE_WORDS[key].toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
