"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  MIN_DAYS,
  decodeMovements,
  dotIndex,
  layoutDots,
  panWindow,
  zoomWindow,
  type Dot,
  type MovementWire,
  type ViewWindow,
} from "@/insights/net-worth-movements";
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
  // Zoomed by hand (the wheel, a pinch, the brush): the days in view; null follows the range.
  const [view, setView] = useState<ViewWindow | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // What's open: a day (collapsed, a significant day's dot) or one of every movement's dots
  // (expanded), and whether its details are open beside it.
  const [opened, setOpened] = useState<Opened | null>(null);
  const [details, setDetails] = useState(false);
  // Every movement, fetched the first time the chart opens (/api/net-worth/movements).
  const [moves, setMoves] = useState<NetWorthEvent[] | null>(null);
  const [movesState, setMovesState] = useState<"idle" | "loading" | "failed">("idle");
  // The movement dot the arrow keys are on.
  const [focusDot, setFocusDot] = useState<number | null>(null);
  // The open boxes' heights, measured once drawn, to place them and grow the chart for them.
  const [sizes, setSizes] = useState<{ summary: number; detail: number }>({
    summary: 96,
    detail: 160,
  });
  const summaryBox = useRef<HTMLDivElement>(null);
  const detailBox = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  // A finger on the line (a drag scrubs until it lets go), and two for a pinch.
  const dragging = useRef(false);
  const fingers = useRef(new Map<number, number>());
  const pinch = useRef<{ distance: number; view: ViewWindow } | null>(null);
  // Expanded, the wheel zooms the time axis around the pointer. A native listener, not React's
  // (passive, so it couldn't stop the page scrolling); it reads this render's state through a ref.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const listen = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener("wheel", listen, { passive: false });
    return () => el.removeEventListener("wheel", listen);
  }, []);

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

  // Every movement, once, the first time the chart opens.
  const firstDay = points[0]?.date;
  const loadMoves = () => {
    if (moves || movesState === "loading" || !firstDay) return;
    setMovesState("loading");
    fetch(`/api/net-worth/movements?from=${firstDay}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((wire: MovementWire) => {
        setMoves(decodeMovements(wire));
        setMovesState("idle");
      })
      .catch(() => setMovesState("failed"));
  };

  // A box's height, measured once drawn (to place it), and shut by Esc or a click outside.
  useLayoutEffect(() => {
    const summary = summaryBox.current?.offsetHeight;
    const detail = detailBox.current?.offsetHeight;
    setSizes((s) => {
      const next = { summary: summary ?? s.summary, detail: detail ?? s.detail };
      return next.summary === s.summary && next.detail === s.detail ? s : next;
    });
  }, [opened, details, width]);
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const back =
        opened.kind === "day"
          ? area.current?.querySelector<HTMLElement>(`[data-net-worth-event="${opened.key}"]`)
          : dotsRef.current;
      setOpened(null);
      setDetails(false);
      back?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (
        t?.closest?.(
          "[data-net-worth-event-card], [data-net-worth-event-detail], [data-net-worth-event], [data-net-worth-plot]",
        )
      )
        return;
      setOpened(null);
      setDetails(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [opened]);

  const today = points[points.length - 1];
  const ranges = rangesFor(points);
  const chip = ranges.includes(range) ? range : "ALL";
  const total = points.length;
  const win = view ?? windowFor(points, chip);
  const shown = points.slice(win.from, win.to + 1);
  const at = scrub === null ? shown.length - 1 : Math.min(scrub, shown.length - 1);
  const point = shown[at] ?? today;
  const move = changeOver(shown, at);
  const single = points.length < 2;

  const narrow = width < 480;
  const H = expanded ? (narrow ? H_EXPANDED_NARROW : H_EXPANDED_WIDE) : narrow ? H_NARROW : H_WIDE;
  const values = shown.map((p) => p.cents);
  const hi0 = values.length ? Math.max(...values) : 0;
  const lo0 = values.length ? Math.min(...values) : 0;
  // A tiny move stays visible but isn't blown up into a cliff.
  const span = Math.max(hi0 - lo0, Math.abs(hi0) * 0.01, 100);
  const mid = (hi0 + lo0) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const x = (i: number) => (shown.length < 2 ? width : (i / (shown.length - 1)) * width);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2);

  // Expanded: a dot for every movement in view, overlapping ones as one until zoomed apart.
  const layout = useMemo(() => {
    if (!expanded || !moves || shown.length === 0) return null;
    const xs = (i: number) => (shown.length < 2 ? width : (i / (shown.length - 1)) * width);
    const ys = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2);
    const dots = layoutDots({ events: moves, days: shown, x: xs, y: ys });
    const inView = new Set(shown.map((p) => p.date));
    return {
      dots,
      hit: dotIndex(dots),
      count: moves.filter((m) => inView.has(m.date)).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, moves, win.from, win.to, width, H, lo, hi]);

  // The wheel's handler, with this render's window; the page scrolls again once the chart can't
  // zoom further that way.
  useEffect(() => {
    onWheel.current = (e: WheelEvent) => {
      if (!expanded || !box.current) return;
      const r = box.current.getBoundingClientRect();
      const share = (e.clientX - r.left) / r.width;
      const next = zoomWindow(win, total, e.deltaY > 0 ? 1.25 : 0.8, share);
      if (next.from === win.from && next.to === win.to) return;
      e.preventDefault();
      setView(next);
      setScrub(null);
      setFocusDot(null);
      setOpened(null);
      setDetails(false);
    };
  });

  if (!today) return null;

  // The days to mark: the biggest in the range on screen, placed on the line (collapsed).
  const dayIndex = new Map(shown.map((p, i) => [p.date, i]));
  const marks = !expanded
    ? daysToMark(events, shown[0]?.date ?? "").flatMap((g) => {
        const i = dayIndex.get(g.date);
        return i === undefined ? [] : [{ group: g, i }];
      })
    : [];
  const shut = () => {
    setOpened(null);
    setDetails(false);
  };
  // What's open, where its dot is now.
  const open: { group: EventGroup; at: { x: number; y: number }; title: string } | null = (() => {
    if (!opened) return null;
    if (opened.kind === "day") {
      const m = marks.find((k) => k.group.date === opened.key);
      return m
        ? {
            group: m.group,
            at: { x: x(m.i), y: y(shown[m.i].cents) },
            title: longDate(m.group.date),
          }
        : null;
    }
    const d = layout?.dots[opened.index];
    return d ? { group: groupOf(d), at: { x: d.x, y: d.y }, title: datesOf(d) } : null;
  })();

  // At most one vertex per pixel; the last point is always kept.
  const step = Math.max(1, Math.floor(shown.length / Math.max(1, width)));
  const path = shown
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % step === 0 || i === shown.length - 1)
    .map(({ p, i }, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`)
    .join(" ");

  const place = open
    ? placeBoxes({
        dot: open.at,
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
  // Zooming: by hand from here on (the chips stop showing as chosen), boxes shut.
  const zoomTo = (next: ViewWindow) => {
    if (next.from === win.from && next.to === win.to) return;
    setView(next);
    setScrub(null);
    setFocusDot(null);
    shut();
  };
  const zoomBy = (factor: number, share = 0.5) => zoomTo(zoomWindow(win, total, factor, share));

  // Monochrome (docs/design/area-pages.md): the line is the page's text colour; up and down
  // are ▲ and ▼ and a sign, never a colour.
  const stroke = "stroke-current";
  const arrow = (cents: number) => (cents >= 0 ? "▲" : "▼");
  const zoomed = view !== null;
  const windowWords = zoomed
    ? `${longDate(shown[0].date)} to ${longDate(shown[shown.length - 1].date)}`
    : RANGE_WORDS[chip];
  const focused = focusDot !== null ? (layout?.dots[focusDot] ?? null) : null;

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
              if (!expanded) loadMoves();
              setExpanded((e) => !e);
              setFocusDot(null);
              shut();
            }}
            className="inline-flex min-h-11 items-center text-xs font-semibold tracking-wider hover:underline"
          >
            {expanded ? "[CLOSE]" : "[EXPAND]"}
            <span className="sr-only">
              {expanded ? " the net worth chart" : " the net worth chart to see every movement"}
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
            {scrub === null ? windowWords : longDate(point.date)}
          </span>
        </p>
      )}

      {!single && (
        <>
          <div ref={area} className="relative" style={{ minHeight: place?.height ?? H }}>
            <div
              ref={box}
              data-net-worth-plot=""
              // Scrubbing is choosing a day: a slider, its value the day and the net worth then.
              role="slider"
              tabIndex={0}
              aria-label={`Net worth, ${windowWords.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={shown.length - 1}
              aria-valuenow={at}
              aria-valuetext={`${at === shown.length - 1 ? "Today" : longDate(point.date)}: ${dollars(point.cents)}`}
              className={`nw-box relative -mx-1 cursor-crosshair outline-offset-4 select-none ${expanded ? "touch-none" : "touch-pan-y"}`}
              style={{ height: H }}
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") {
                  fingers.current.set(e.pointerId, e.clientX);
                  if (expanded && fingers.current.size === 2) {
                    // Two fingers: a pinch zooms instead of scrubbing.
                    const [a, b] = [...fingers.current.values()];
                    pinch.current = { distance: Math.max(1, Math.abs(a - b)), view: win };
                    dragging.current = false;
                    setScrub(null);
                    return;
                  }
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
                if (e.pointerType !== "mouse" && fingers.current.has(e.pointerId)) {
                  fingers.current.set(e.pointerId, e.clientX);
                  if (pinch.current && fingers.current.size === 2) {
                    const [a, b] = [...fingers.current.values()];
                    const r = e.currentTarget.getBoundingClientRect();
                    const factor = pinch.current.distance / Math.max(1, Math.abs(a - b));
                    const share = ((a + b) / 2 - r.left) / r.width;
                    zoomTo(zoomWindow(pinch.current.view, total, factor, share));
                    return;
                  }
                }
                if (e.pointerType === "mouse" || dragging.current) setScrub(indexAt(e.clientX));
              }}
              onPointerUp={(e) => {
                fingers.current.delete(e.pointerId);
                if (fingers.current.size < 2) pinch.current = null;
                if (e.pointerType !== "mouse") {
                  dragging.current = false;
                  setScrub(null);
                }
              }}
              onPointerCancel={(e) => {
                fingers.current.delete(e.pointerId);
                pinch.current = null;
                dragging.current = false;
                setScrub(null);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setScrub(null);
              }}
              onClick={(e) => {
                // A tap or click on a movement's dot opens it.
                if (!layout) return;
                const r = e.currentTarget.getBoundingClientRect();
                const i = layout.hit(e.clientX - r.left, e.clientY - r.top);
                if (i === null) return;
                setDetails(false);
                setFocusDot(i);
                setOpened({ kind: "dot", index: i, key: `dot:${i}` });
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
                else if (expanded && (e.key === "+" || e.key === "=")) zoomBy(0.5);
                else if (expanded && e.key === "-") zoomBy(2);
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
                  key={`${chip}-${zoomed ? "zoom" : shown.length}`}
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
                    cy={y(shown[shown.length - 1].cents)}
                    r={3.5}
                    className="fill-current"
                  />
                )}
              </svg>
              {expanded && layout && (
                <MovementDots
                  ref={dotsRef}
                  dots={layout.dots}
                  movements={layout.count}
                  width={width}
                  height={H}
                  selected={opened?.kind === "dot" ? opened.index : null}
                  focus={focusDot}
                  onFocusDot={setFocusDot}
                  onOpen={(i) => {
                    setDetails(false);
                    setOpened({ kind: "dot", index: i, key: `dot:${i}` });
                  }}
                  onShut={shut}
                />
              )}
            </div>
            {expanded && movesState !== "idle" && (
              <p
                role="status"
                className="pointer-events-none absolute top-1 left-0 text-xs text-zinc-600 dark:text-zinc-400"
              >
                {movesState === "loading"
                  ? "Loading every movement…"
                  : "Couldn't load every movement. Close and open the chart to try again."}
              </p>
            )}
            {focused && (
              <p aria-live="polite" className="sr-only">
                {datesOf(focused)}: {focused.events.map(summaryLine).join("; ")}
              </p>
            )}
            {/* The significant days (collapsed) as dots, and whatever is open, inside the chart:
              its summary, and More details beside it joined by a marching dotted line. */}
            <div className="pointer-events-none absolute inset-0 -mx-1">
              {marks.map(({ group, i }) => (
                <button
                  key={group.date}
                  type="button"
                  data-net-worth-event={group.date}
                  aria-label={`${longDate(group.date)}: ${group.events
                    .map((e) => `${e.label} ${effect(e)}`)
                    .join("; ")}`}
                  aria-expanded={opened?.key === group.date}
                  aria-controls={opened?.key === group.date ? "net-worth-day" : undefined}
                  onClick={() => {
                    setDetails(false);
                    setOpened((o) =>
                      o?.key === group.date ? null : { kind: "day", key: group.date },
                    );
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
                      opened?.key === group.date ? "bg-current" : "bg-white dark:bg-zinc-950"
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
                    title={open.title}
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
                        title={open.title}
                        at={place.detail}
                        onClose={() => setDetails(false)}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {expanded && (
            <Brush
              points={points}
              view={win}
              onChange={zoomTo}
              onZoom={zoomBy}
              words={windowWords}
            />
          )}

          <div role="group" aria-label="Range" className="flex flex-wrap gap-1">
            {ranges.map((key) => {
              const on = !zoomed && key === chip;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setRange(key);
                    setView(null);
                    setScrub(null);
                    setFocusDot(null);
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

type Opened = { kind: "day"; key: string } | { kind: "dot"; index: number; key: string };

// A range chip's days, as a window over the whole history.
function windowFor(points: readonly SeriesPoint[], range: RangeKey): ViewWindow {
  const last = Math.max(0, points.length - 1);
  if (range === "ALL" || points.length === 0) return { from: 0, to: last };
  const first = pointsIn(points, range)[0]?.date;
  const from = Math.max(
    0,
    points.findIndex((p) => p.date === first),
  );
  return { from, to: last };
}

// A movement dot's movements as a day's group (the boxes take groups), and the day or days it
// covers ("Sep 24, 2026", or "Sep 3, 2026 to Sep 9, 2026" when zoomed out it holds several).
const groupOf = (d: Dot): EventGroup => ({
  date: d.events[0].date,
  cents: d.events.reduce((sum, e) => sum + e.cents, 0),
  events: d.events,
});
const datesOf = (d: Dot) => {
  const first = d.events[0].date;
  const last = d.events[d.events.length - 1].date;
  return first === last ? longDate(first) : `${longDate(first)} to ${longDate(last)}`;
};

// Every movement's dot, drawn on a canvas (thousands of them at once, kept smooth on a phone):
// a hollow square each, filled when open, ×N beside a group. Focusable: the arrow keys move
// between dots, Enter opens one, Esc shuts it.
function MovementDots({
  ref,
  dots,
  movements,
  width,
  height,
  selected,
  focus,
  onFocusDot,
  onOpen,
  onShut,
}: {
  ref: React.RefObject<HTMLCanvasElement | null>;
  dots: Dot[];
  movements: number;
  width: number;
  height: number;
  selected: number | null;
  focus: number | null;
  onFocusDot: (i: number | null) => void;
  onOpen: (i: number) => void;
  onShut: () => void;
}) {
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // The page's text colour for the squares, and the chart's own background inside them.
    const ink = getComputedStyle(canvas).color;
    const card = canvas.closest("[data-net-worth-chart]");
    const paper = card ? getComputedStyle(card).backgroundColor : "rgb(255, 255, 255)";
    ctx.lineWidth = 1.5;
    ctx.font = "600 9px ui-monospace, monospace";
    dots.forEach((d, i) => {
      const s = d.events.length > 1 ? 7 : 5;
      ctx.fillStyle = i === selected ? ink : paper;
      ctx.strokeStyle = ink;
      ctx.fillRect(d.x - s / 2, d.y - s / 2, s, s);
      ctx.strokeRect(d.x - s / 2, d.y - s / 2, s, s);
      if (d.events.length > 1) {
        ctx.fillStyle = ink;
        ctx.fillText(`×${d.events.length}`, d.x + 5, d.y + 11);
      }
      if (i === focus) {
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(d.x - 8, d.y - 8, 16, 16);
        ctx.setLineDash([]);
      }
    });
  }, [ref, dots, width, height, selected, focus]);

  return (
    <canvas
      ref={ref}
      data-net-worth-dots=""
      data-dots={dots.length}
      data-movements={movements}
      tabIndex={0}
      role="group"
      aria-roledescription="every movement"
      aria-label={`${movements} movements in view, ${dots.length} dots. Arrow keys move between them, Enter opens one.`}
      onKeyDown={(e) => {
        if (dots.length === 0) return;
        const at = focus ?? -1;
        if (e.key === "ArrowRight") onFocusDot(Math.min(dots.length - 1, at + 1));
        else if (e.key === "ArrowLeft") onFocusDot(Math.max(0, at < 0 ? dots.length - 1 : at - 1));
        else if (e.key === "Home") onFocusDot(0);
        else if (e.key === "End") onFocusDot(dots.length - 1);
        else if ((e.key === "Enter" || e.key === " ") && focus !== null) onOpen(focus);
        else if (e.key === "Escape") onShut();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className="pointer-events-none absolute inset-0 text-zinc-950 outline-offset-4 dark:text-zinc-50"
      style={{ width, height }}
    />
  );
}

// Under the expanded chart: the whole history small, the days in view as a window to drag
// (or its edges, to zoom), and zoom buttons. Keyboard: ← → move it, + − zoom.
function Brush({
  points,
  view,
  onChange,
  onZoom,
  words,
}: {
  points: SeriesPoint[];
  view: ViewWindow;
  onChange: (v: ViewWindow) => void;
  onZoom: (factor: number) => void;
  words: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "from" | "to"; x: number; view: ViewWindow } | null>(null);
  const total = points.length;
  const last = Math.max(1, total - 1);
  const values = points.map((p) => p.cents);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const path = points
    .filter((_, i) => i % Math.max(1, Math.floor(total / 200)) === 0 || i === last)
    .map((p, k) => {
      const i = points.indexOf(p);
      return `${k === 0 ? "M" : "L"}${((i / last) * 100).toFixed(2)},${(28 - ((p.cents - lo) / Math.max(1, hi - lo)) * 24).toFixed(1)}`;
    })
    .join(" ");
  const days = (dx: number) => {
    const w = track.current?.clientWidth ?? 1;
    return Math.round((dx / w) * last);
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onZoom(2)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-semibold hover:underline"
      >
        [−]<span className="sr-only">Zoom out</span>
      </button>
      <div
        ref={track}
        data-net-worth-brush=""
        role="slider"
        tabIndex={0}
        aria-label="Days in view"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={view.from}
        aria-valuetext={words}
        className="relative h-8 min-w-0 flex-1 touch-none border border-dashed border-zinc-300 outline-offset-2 select-none dark:border-zinc-700"
        onKeyDown={(e) => {
          const span = view.to - view.from;
          const stepDays = Math.max(1, Math.round(span / 4));
          if (e.key === "ArrowLeft") onChange(panWindow(view, total, -stepDays));
          else if (e.key === "ArrowRight") onChange(panWindow(view, total, stepDays));
          else if (e.key === "+" || e.key === "=") onZoom(0.5);
          else if (e.key === "-") onZoom(2);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const day = Math.round(((e.clientX - r.left) / r.width) * last);
          const edge = Math.max(2, Math.round((8 / r.width) * last));
          const mode =
            Math.abs(day - view.from) <= edge
              ? "from"
              : Math.abs(day - view.to) <= edge
                ? "to"
                : day > view.from && day < view.to
                  ? "move"
                  : null;
          if (!mode) {
            // Outside the window: it moves there, centred.
            const span = view.to - view.from;
            onChange(panWindow(view, total, day - span / 2 - view.from));
            return;
          }
          drag.current = { mode, x: e.clientX, view };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const moved = days(e.clientX - d.x);
          if (d.mode === "move") onChange(panWindow(d.view, total, moved));
          else if (d.mode === "from")
            onChange({
              from: Math.max(0, Math.min(d.view.from + moved, d.view.to - (MIN_DAYS - 1))),
              to: d.view.to,
            });
          else
            onChange({
              from: d.view.from,
              to: Math.min(last, Math.max(d.view.to + moved, d.view.from + (MIN_DAYS - 1))),
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <path
            d={path}
            fill="none"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-zinc-400 dark:stroke-zinc-600"
          />
        </svg>
        <div
          aria-hidden="true"
          className="absolute inset-y-0 border-x-2 border-current bg-zinc-950/10 dark:bg-zinc-50/10"
          style={{
            left: `${(view.from / last) * 100}%`,
            width: `${((view.to - view.from) / last) * 100}%`,
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => onZoom(0.5)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-semibold hover:underline"
      >
        [+]<span className="sr-only">Zoom in</span>
      </button>
    </div>
  );
}

// A day's summary: what moved the money, a line each (at most SUMMARY_LINES, then "+N more"),
// More details and close. Inside the chart, where placeBoxes put it.
function DaySummary({
  ref,
  group,
  title,
  at,
  details,
  onDetails,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  group: EventGroup;
  // The day ("Sep 24, 2026"), or the days a zoomed-out dot holds.
  title: string;
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
      aria-label={`What moved your money on ${title}`}
      data-net-worth-event-card=""
      className="nw-box-in pointer-events-auto absolute z-10 flex flex-col gap-1 border-2 border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold tabular-nums">{title}</p>
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
  title,
  at,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  group: EventGroup;
  title: string;
  at: Rect;
  onClose: () => void;
}) {
  return (
    <div
      ref={ref}
      id="net-worth-day-details"
      role="group"
      aria-label={`Every movement on ${title}`}
      data-net-worth-event-detail=""
      className="nw-box-in pointer-events-auto absolute z-10 flex flex-col gap-2 border-2 border-dashed border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold"># {title}</p>
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
        <span>{group.events.some((e) => e.date !== group.date) ? "Together" : "That day"}</span>
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
