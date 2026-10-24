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
import {
  EVENT_KIND_WORDS,
  daysToMark,
  type EventGroup,
  type NetWorthEvent,
} from "@/insights/net-worth-events";
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
// A day's boxes (founder: "each dot should have an expandable box that shows exactly where that
// money went … and if they want to view more details it should lead to another box next to it
// connected by dotted animated line"): the summary's and the details' widths, the gap the line
// crosses, and the summary's lines before "+N more".
const SUMMARY_W = 240;
const DETAIL_W = 300;
const GAP = 28;
const SUMMARY_LINES = 3;

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
// One line of a day's summary: "−$1,640 · card payment · Chase ····5003".
export const summaryLine = (e: NetWorthEvent) =>
  [effect(e), EVENT_KIND_WORDS[e.kind], e.account ?? e.name].filter(Boolean).join(" · ");

type Rect = { left: number; top: number; width: number; height: number };

// Where a day's boxes go inside the chart (never over anything outside it): beside each other
// when there's room, the details on the side with more space; stacked on a narrow chart. The
// summary sits above a dot in the lower half and below one in the upper half; the chart grows
// to hold whatever doesn't fit. Pure, for the tests.
export function placeBoxes({
  dot,
  width,
  height,
  summary,
  detail,
}: {
  dot: { x: number; y: number };
  width: number;
  height: number;
  summary: number;
  // The details box's height, or null while it's closed.
  detail: number | null;
}): { summary: Rect; detail: Rect | null; stacked: boolean; height: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const sw = Math.min(SUMMARY_W, width);
  const dw = Math.min(DETAIL_W, width);
  const stacked = detail !== null && width < sw + GAP + dw;
  const below = stacked || dot.y <= height / 2;
  const sTop = below ? dot.y + MARK / 2 + 2 : Math.max(0, dot.y - MARK / 2 - 2 - summary);
  if (detail === null) {
    const s = { left: clamp(dot.x - sw / 2, 0, width - sw), top: sTop, width: sw, height: summary };
    return {
      summary: s,
      detail: null,
      stacked: false,
      height: Math.max(height, sTop + summary + 8),
    };
  }
  if (stacked) {
    const s = { left: clamp(dot.x - sw / 2, 0, width - sw), top: sTop, width: sw, height: summary };
    const d = {
      left: clamp(dot.x - dw / 2, 0, width - dw),
      top: sTop + summary + GAP,
      width: dw,
      height: detail,
    };
    return { summary: s, detail: d, stacked, height: Math.max(height, d.top + detail + 8) };
  }
  // Side by side: the details go toward the middle, so a dot at either edge keeps both inside.
  const right = dot.x <= width / 2;
  const sLeft = right
    ? clamp(dot.x - sw / 2, 0, width - sw - GAP - dw)
    : clamp(dot.x - sw / 2, dw + GAP, width - sw);
  const s = { left: sLeft, top: sTop, width: sw, height: summary };
  const dTop = clamp(sTop, 0, Math.max(0, height - detail));
  const d = {
    left: right ? sLeft + sw + GAP : sLeft - GAP - dw,
    top: dTop,
    width: dw,
    height: detail,
  };
  return {
    summary: s,
    detail: d,
    stacked,
    height: Math.max(height, sTop + summary + 8, dTop + detail + 8),
  };
}

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
  // The marker whose summary is open, by date, and whether its details are open beside it.
  const [marked, setMarked] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  // The open boxes' heights, measured once drawn, to place them and grow the chart for them.
  const [sizes, setSizes] = useState<{ summary: number; detail: number }>({
    summary: 96,
    detail: 160,
  });
  const summaryBox = useRef<HTMLDivElement>(null);
  const detailBox = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
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

  // A day's boxes: measured once drawn (to place them), and shut by Esc or a click outside.
  useLayoutEffect(() => {
    const summary = summaryBox.current?.offsetHeight;
    const detail = detailBox.current?.offsetHeight;
    setSizes((s) => {
      const next = { summary: summary ?? s.summary, detail: detail ?? s.detail };
      return next.summary === s.summary && next.detail === s.detail ? s : next;
    });
  }, [marked, details, width]);
  useEffect(() => {
    if (!marked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const dot = area.current?.querySelector<HTMLElement>(`[data-net-worth-event="${marked}"]`);
      setMarked(null);
      setDetails(false);
      dot?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (
        t?.closest?.(
          "[data-net-worth-event-card], [data-net-worth-event-detail], [data-net-worth-event]",
        )
      )
        return;
      setMarked(null);
      setDetails(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [marked]);

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
  const shut = () => {
    setMarked(null);
    setDetails(false);
  };

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

  const place = open
    ? placeBoxes({
        dot: { x: x(open.i), y: y(shown[open.i].cents) },
        width,
        height: H,
        summary: sizes.summary,
        detail: details ? sizes.detail : null,
      })
    : null;

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
          prefetch={false}
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
              shut();
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
          <div ref={area} className="relative" style={{ minHeight: place?.height ?? H }}>
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
              className="nw-box relative -mx-1 cursor-crosshair touch-pan-y outline-offset-4 select-none"
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
            {/* Expanded, the days money moved because of something: a dot on the line each. A
              click opens the day's summary inside the chart, and More details opens the full
              list beside it, joined by a marching dotted line. */}
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
                    aria-controls={marked === group.date ? "net-worth-day" : undefined}
                    onClick={() => {
                      setDetails(false);
                      setMarked((m) => (m === group.date ? null : group.date));
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
                    {group.events.length > 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-full -mt-1 text-[10px] leading-none font-semibold tabular-nums"
                      >
                        ×{group.events.length}
                      </span>
                    )}
                  </button>
                ))}
                {open && place && (
                  <>
                    <DaySummary
                      ref={summaryBox}
                      group={open.group}
                      at={place.summary}
                      details={details}
                      onDetails={() => setDetails((d) => !d)}
                      onClose={shut}
                    />
                    {details && place.detail && (
                      <>
                        <Connector from={place.summary} to={place.detail} stacked={place.stacked} />
                        <DayDetails
                          ref={detailBox}
                          group={open.group}
                          at={place.detail}
                          onClose={() => setDetails(false)}
                        />
                      </>
                    )}
                  </>
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
                    shut();
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

// A day's summary: what moved the money, a line each (at most SUMMARY_LINES, then "+N more"),
// More details and close. Inside the chart, where placeBoxes put it.
function DaySummary({
  ref,
  group,
  at,
  details,
  onDetails,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  group: EventGroup;
  at: Rect;
  details: boolean;
  onDetails: () => void;
  onClose: () => void;
}) {
  const extra = group.events.length - SUMMARY_LINES;
  return (
    <div
      ref={ref}
      id="net-worth-day"
      role="group"
      aria-label={`What moved your money on ${longDate(group.date)}`}
      data-net-worth-event-card=""
      className="nw-box-in pointer-events-auto absolute z-10 flex flex-col gap-1 border-2 border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold tabular-nums">{longDate(group.date)}</p>
        <button
          type="button"
          onClick={onClose}
          className="-my-1 inline-flex min-h-8 items-center font-semibold hover:underline"
        >
          [X]<span className="sr-only"> Close</span>
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {group.events.slice(0, SUMMARY_LINES).map((e, k) => (
          <li key={k} className="tabular-nums [overflow-wrap:anywhere]">
            {summaryLine(e)}
          </li>
        ))}
      </ul>
      {extra > 0 && <p className="text-zinc-600 dark:text-zinc-400">+{extra} more</p>}
      <button
        type="button"
        aria-expanded={details}
        aria-controls={details ? "net-worth-day-details" : undefined}
        onClick={onDetails}
        className="self-start font-semibold tracking-wider hover:underline"
      >
        {details ? "[LESS]" : "[MORE DETAILS]"}
      </button>
    </div>
  );
}

// The full breakdown, beside the summary: every event that day with its account, what it did and
// where to see it, and the day's total.
function DayDetails({
  ref,
  group,
  at,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  group: EventGroup;
  at: Rect;
  onClose: () => void;
}) {
  return (
    <div
      ref={ref}
      id="net-worth-day-details"
      role="group"
      aria-label={`Every movement on ${longDate(group.date)}`}
      data-net-worth-event-detail=""
      className="nw-box-in pointer-events-auto absolute z-10 flex flex-col gap-2 border-2 border-dashed border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold"># {longDate(group.date)}</p>
        <button
          type="button"
          onClick={onClose}
          className="-my-1 inline-flex min-h-8 items-center font-semibold hover:underline"
        >
          [X]<span className="sr-only"> Close the details</span>
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {group.events.map((e, k) => (
          <li
            key={k}
            className="flex flex-col border-t border-dashed border-zinc-300 pt-1 first:border-0 first:pt-0 dark:border-zinc-700"
          >
            <span className="flex items-baseline justify-between gap-2">
              <Link
                href={e.href}
                className="min-w-0 font-medium [overflow-wrap:anywhere] hover:underline"
              >
                {e.label}
              </Link>
              <span className="shrink-0 font-semibold tabular-nums">{effect(e)}</span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              {[EVENT_KIND_WORDS[e.kind], e.account, longDate(e.date)].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-2 border-t border-current pt-1 font-semibold tabular-nums">
        <span>That day</span>
        <span>{group.cents === 0 ? "No change" : signed(group.cents)}</span>
      </p>
    </div>
  );
}

// The marching dotted line from the summary to its details (no march with reduced motion).
function Connector({ from, to, stacked }: { from: Rect; to: Rect; stacked: boolean }) {
  const a = stacked
    ? { x: from.left + from.width / 2, y: from.top + from.height }
    : to.left > from.left
      ? { x: from.left + from.width, y: from.top + Math.min(24, from.height / 2) }
      : { x: from.left, y: from.top + Math.min(24, from.height / 2) };
  const b = stacked
    ? { x: to.left + to.width / 2, y: to.top }
    : to.left > from.left
      ? { x: to.left, y: to.top + 24 }
      : { x: to.left + to.width, y: to.top + 24 };
  const d = stacked
    ? `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`
    : `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;
  return (
    <svg
      aria-hidden="true"
      data-net-worth-connector=""
      className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={2}
        strokeDasharray="3 6"
        className="ask-line stroke-current"
      />
    </svg>
  );
}
