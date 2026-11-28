"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
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
  DOT_GAP,
  DOT_GAP_NARROW,
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
import { formatWholeDollars } from "@/lib/money";
import { Blinded, ShowValue } from "./blinded";
import { MarchingPath } from "@/components/marching-path";
import {
  SCALE_EASE_MS,
  fitScale,
  linePath,
  niceTicks,
  gutterFor,
  scaleAt,
  type ChartScale,
} from "./net-worth-geometry";
import { dayLabel, monthLabel } from "@/lib/day-label";
import { CHART_VIEW_STORAGE_KEY } from "@/config/net-worth-changes";
import { barLabel, bucketChanges, changeScale, type Bar } from "./net-worth-changes";

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
  ALL: "All time",
};

// The scale's own range, eased to each new fit (SCALE_EASE_MS in net-worth-geometry.ts), so
// zooming, panning or picking a range slides the line rather than jumping it. Reduced motion
// gets each fit at once, and so does the first draw.
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const reducedNow = () =>
  typeof window.matchMedia === "function" && window.matchMedia(REDUCED).matches;

function useEasedRange(target: { lo: number; hi: number }): { lo: number; hi: number } {
  const [shown, setShown] = useState(target);
  const now = useRef(target);
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false);
  const { lo, hi } = target;
  useEffect(() => {
    const goal = { lo, hi };
    const from = now.current;
    if (reduced || (from.lo === goal.lo && from.hi === goal.hi)) {
      now.current = goal;
      // Keep the eased copy current too, for when reduced motion is turned off again.
      setShown((s) => (s.lo === goal.lo && s.hi === goal.hi ? s : goal));
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (at: number) => {
      const t = Math.min(1, (at - start) / SCALE_EASE_MS);
      const e = 1 - (1 - t) ** 3;
      now.current = {
        lo: from.lo + (goal.lo - from.lo) * e,
        hi: from.hi + (goal.hi - from.hi) * e,
      };
      setShown(now.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, lo, hi]);
  return reduced ? target : shown;
}

// Whole dollars, rounded (it said $376/yr where the import chip said $377/yr for $376.80).
const dollars = formatWholeDollars;
const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${dollars(Math.abs(cents))}`;
const percent = (share: number) =>
  `${share >= 0 ? "+" : "−"}${(Math.abs(share) * 100).toFixed(Math.abs(share) < 0.1 ? 2 : 1)}%`;

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
  notCounting,
  loansLeft,
  covers,
  flatNote,
  maybeSame,
  maybeSameHref = "/import",
}: {
  points: SeriesPoint[];
  // The days money moved because of something (src/lib/hub/net-worth-events.ts).
  events?: EventGroup[];
  // What the figure leaves out for want of a balance, said under it (src/insights/net-worth.ts).
  notCounting?: string;
  loansLeft?: string | null;
  // What the figure covers (netWorthCovers), said under it.
  covers?: string | null;
  // What stands at its first known value before that day (investments, loans), said under it.
  flatNote?: string | null;
  // Accounts that may be one account counted twice (maybeSameWords), said under it.
  maybeSame?: string | null;
  // Where one of them is removed: the import page for an upload, else the bank links in Settings.
  maybeSameHref?: string;
}) {
  // Hidden until asked: the figure, and what would give it away (the scale, the dollars moved, the
  // figure on a day). The line's shape and the percent stay: they don't say how much.
  const [figureShown, setFigureShown] = useState(false);
  const [range, setRange] = useState<RangeKey>("ALL");
  // The line of net worth, or one bar per period of how much it moved (the person's choice, kept
  // on this device; read after the first paint so the server's and the browser's first HTML agree).
  const [mode, setMode] = useState<"line" | "changes">("line");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHART_VIEW_STORAGE_KEY) === "changes") setMode("changes");
    } catch {
      // No storage (a private window): the line.
    }
  }, []);
  // Zoomed by hand (the wheel, a pinch, the brush): the days in view; null follows the range.
  const [view, setView] = useState<ViewWindow | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const clipId = useId();
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
  // Whether the plot has its real width yet. Until then it's out of sight at the height it will
  // have (globals.css .nw-box[data-unmeasured]): a slow phone showed a wide screen's chart, taller
  // and past the card's edge, until the page woke (mobile pass 11-16).
  const [measured, setMeasured] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A finger on the line (a drag scrubs until it lets go), and two for a pinch.
  const dragging = useRef(false);
  const fingers = useRef(new Map<number, number>());
  const pinch = useRef<{ distance: number; view: ViewWindow } | null>(null);
  // Expanded, the wheel zooms the time axis around the pointer. A native listener, not React's
  // (passive, so it couldn't stop the page scrolling); it reads this render's state through a ref.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  const wheelRemainder = useRef(0);
  // A mouse drag across the chart selects the days to zoom into: where it started, whether it has
  // moved far enough to be a selection (not a click), and its two edges in px for the highlight.
  const selecting = useRef<{ x: number; moved: boolean } | null>(null);
  const justSelected = useRef(false);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const listen = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener("wheel", listen, { passive: false });
    return () => el.removeEventListener("wheel", listen);
  }, []);

  const sized = (w: number) => {
    if (w <= 0) return;
    setWidth(w);
    setMeasured(true);
  };
  useLayoutEffect(() => {
    if (box.current) sized(box.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => sized(Math.round(e.contentRect.width)));
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

  // Every movement from the start, not only once expanded: each day money moved is a dot to tap
  // (founder: "the graph doesn't show every single movement of the money, and can't click on them").
  useEffect(() => {
    if (!firstDay) return;
    let live = true;
    fetch(`/api/net-worth/movements?from=${firstDay}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((wire: MovementWire) => {
        if (live) setMoves(decodeMovements(wire));
      })
      // The biggest days stay marked; expanding tries again.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [firstDay]);

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
  // The scale fits exactly the days in view (their own range, and a floor that follows their own
  // moves) and settles on each new fit over a moment (not with reduced motion).
  const fit = fitScale(values);
  const eased = useEasedRange({ lo: fit.lo, hi: fit.hi });
  const { lo, hi } = eased;
  // The axis labels (the target fit's, so the line does not shift as the scale eases), and the
  // room at the left they need while the figures are shown.
  const ticks = niceTicks(fit.lo, fit.hi);
  // Changes view: a bar for each day, week or month on screen, on its own scale (refit to the bars
  // in view), each in a slot of the width after the axis labels.
  const changes = mode === "changes";
  const bars: Bar[] = changes ? bucketChanges(points, win.from, win.to) : [];
  const barScale = changes ? changeScale(bars, H) : null;
  const barTicks = barScale?.ticks ?? [];
  const gutter = figureShown ? gutterFor((changes ? barTicks : ticks).map(dollars)) : 0;
  const slot = bars.length ? (width - gutter) / bars.length : 0;
  // The bar a day (an index among those shown) belongs to.
  const barAt = (day: number) =>
    Math.max(
      0,
      bars.findIndex((b) => b.endIndex - win.from >= day),
    );
  const activeBar = changes && scrub !== null ? (bars[barAt(at)] ?? null) : null;
  // Hovered or scrubbed: what that day (or bar) did to net worth, besides where it stands.
  const dayIndex0 = win.from + at;
  const stepCents =
    activeBar?.change ??
    (dayIndex0 > 0 ? points[dayIndex0].cents - points[dayIndex0 - 1].cents : 0);
  const stepWords = activeBar
    ? barLabel(
        activeBar,
        (d) => dayLabel(d, { year: true }),
        (m) => monthLabel(m, { long: true }),
      )
    : dayLabel(point.date, { year: true });
  // A pointer's place across the days (0 to 1), left of the gutter being the first day.
  const shareOf = (clientX: number, r: { left: number; width: number }) =>
    Math.min(1, Math.max(0, (clientX - r.left - gutter) / Math.max(1, r.width - gutter)));
  const { x, y } = scaleAt(eased, values.length, width, H, gutter);
  const scale: ChartScale = { ...fit, lo, hi, x, y };
  const yDay = (i: number) => y(shown[i].cents);

  // A dot for every movement in view, overlapping ones as one until zoomed apart.
  const layout = useMemo(() => {
    if (!moves || shown.length === 0) return null;
    // A phone's narrow chart groups more: a dot and its ×N label need the room (QA round 9).
    const gap = narrow ? DOT_GAP_NARROW : DOT_GAP;
    const dots = layoutDots({ events: moves, days: shown, x, y, gap });
    const inView = new Set(shown.map((p) => p.date));
    return {
      dots,
      hit: dotIndex(dots),
      count: moves.filter((m) => inView.has(m.date)).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, moves, win.from, win.to, width, H, lo, hi, narrow, gutter]);

  // The wheel's handler, with this render's window; the page scrolls again once the chart can't
  // zoom further that way.
  useEffect(() => {
    onWheel.current = (e: WheelEvent) => {
      if (!box.current) return;
      const r = box.current.getBoundingClientRect();
      const share = shareOf(e.clientX, r);
      // A sideways swipe (a trackpad, shift and the wheel) moves the days in view, so a big step
      // can be dragged out of them without the brush.
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      // Inline, the page keeps its wheel: a trackpad pinch (Ctrl + wheel) zooms, and a sideways
      // swipe pans once zoomed. Expanded, the wheel zooms.
      if (sideways ? !(expanded || view) : !(expanded || e.ctrlKey || e.metaKey)) return;
      let next: ViewWindow;
      if (sideways) {
        // Nothing to pan that way: leave the swipe to the page.
        if (e.deltaX < 0 ? win.from <= 0 : win.to >= total - 1) {
          wheelRemainder.current = 0;
          return;
        }
        // Slow swipes move a fraction of a day each: they add up until there is a whole day.
        wheelRemainder.current += (e.deltaX / r.width) * (win.to - win.from);
        const days = Math.trunc(wheelRemainder.current);
        if (days === 0) {
          e.preventDefault();
          return;
        }
        wheelRemainder.current -= days;
        next = panWindow(win, total, days);
      } else {
        next = zoomWindow(win, total, e.deltaY > 0 ? 1.25 : 0.8, share);
      }
      if (next.from === win.from && next.to === win.to) {
        wheelRemainder.current = 0;
        return;
      }
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
  // Until every movement is in (or if it couldn't load), the biggest days stand in.
  const marks =
    !expanded && !layout && !changes
      ? daysToMark(events, shown[0]?.date ?? "").flatMap((g) => {
          const i = dayIndex.get(g.date);
          return i === undefined ? [] : [{ group: g, i }];
        })
      : [];
  const shut = () => {
    setOpened(null);
    setDetails(false);
  };
  // Net worth at the end of a day (or the last of a dot's days), from the line.
  const byDate = new Map(points.map((p) => [p.date, p.cents]));
  const worthOn = (g: EventGroup) => byDate.get(lastDate(g));
  // What's open, where its dot is now.
  const open: { group: EventGroup; at: { x: number; y: number }; title: string } | null = (() => {
    if (!opened) return null;
    if (opened.kind === "day") {
      const m = marks.find((k) => k.group.date === opened.key);
      return m
        ? {
            group: m.group,
            at: { x: x(m.i), y: yDay(m.i) },
            title: dayLabel(m.group.date, { year: true }),
          }
        : null;
    }
    const d = layout?.dots[opened.index];
    return d ? { group: groupOf(d), at: { x: d.x, y: d.y }, title: datesOf(d) } : null;
  })();

  const path = linePath(values, scale, width);
  const place = open
    ? placeBoxes({
        dot: open.at,
        width,
        height: H,
        summary: sizes.summary,
        // On a phone More details is a sheet from the bottom, not a box in the chart.
        detail: details && !narrow ? sizes.detail : null,
      })
    : null;

  // The day under a pointer, by the days shown (what a drag-selection zooms to).
  const dayAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || shown.length < 2) return shown.length - 1;
    const share = shareOf(clientX, rect);
    return Math.round(share * (shown.length - 1));
  };
  // What a pointer scrubs to: the day under it, or in the Changes view the end of the bar under it.
  const indexAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!changes || !rect || bars.length === 0) return dayAt(clientX);
    const share = shareOf(clientX, rect);
    const bar = bars[Math.min(bars.length - 1, Math.floor(share * bars.length))];
    return bar.endIndex - win.from;
  };
  // One bar or day left or right of where the arrow keys are.
  const stepFrom = (from: number, by: number) => {
    if (!changes || bars.length === 0) return from + by;
    const to = Math.min(bars.length, Math.max(0, barAt(from) + by));
    return to >= bars.length ? shown.length : bars[to].endIndex - win.from;
  };
  // Zooming: by hand from here on (the chips stop showing as chosen), boxes shut.
  const zoomTo = (next: ViewWindow) => {
    if (next.from === win.from && next.to === win.to) return;
    setView(next);
    setScrub(null);
    setFocusDot(null);
    shut();
  };
  // Back to the chosen range.
  const resetView = () => {
    setView(null);
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
  // All of it starts at the first statement day, not when the person signed up (debugger 10-30:
  // "+$8,282 Since you started" minutes after a new user's first upload).
  const windowWords = zoomed
    ? `${dayLabel(shown[0].date, { year: true })} to ${dayLabel(shown[shown.length - 1].date, { year: true })}`
    : chip === "ALL" && shown[0]
      ? `Since ${dayLabel(shown[0].date, { year: true })}`
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
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {expanded ? "Close" : "Expand"}
            <span className="sr-only">
              {expanded ? " the net worth chart" : " the net worth chart to see every movement"}
            </span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <p
          data-hub-number="net-worth"
          className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
        >
          {figureShown ? dollars(point.cents) : <Blinded />}
        </p>
        <ShowValue
          shown={figureShown}
          what="net worth"
          onToggle={() => setFigureShown((s) => !s)}
        />
      </div>
      {covers && (
        <p data-net-worth-covers="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {covers}
        </p>
      )}
      {flatNote && (
        <p data-net-worth-flat-note="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {flatNote}
        </p>
      )}
      {notCounting && (
        <p data-net-worth-not-counting="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {notCounting}{" "}
          <Link href="/import" className="font-medium underline">
            Add a balance
          </Link>
        </p>
      )}
      {maybeSame && (
        <p data-net-worth-maybe-same="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {maybeSame}{" "}
          <Link href={maybeSameHref} className="underline">
            See them
          </Link>
        </p>
      )}
      {loansLeft && (
        <p data-net-worth-loans="" className="text-sm text-zinc-600 dark:text-zinc-400">
          {loansLeft}
        </p>
      )}
      {single ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your line starts today. It grows each day from here.
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
          <p data-net-worth-change="" className="text-sm tabular-nums">
            <span className="font-semibold">
              <span aria-hidden="true">{arrow(move.cents)} </span>
              {figureShown ? (
                <>
                  {signed(move.cents)}
                  {move.share !== null && ` (${percent(move.share)})`}
                </>
              ) : (
                move.share !== null && percent(move.share)
              )}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">
              {scrub === null ? windowWords : stepWords}
            </span>
          </p>
          {scrub !== null && (
            <span data-net-worth-step="" className="font-semibold">
              {figureShown ? signed(stepCents) : arrow(stepCents)}
              <span className="font-normal text-zinc-600 dark:text-zinc-400">
                {activeBar && activeBar.period !== "day" ? " in the period" : " that day"}
              </span>
            </span>
          )}
        </div>
      )}

      {!single && (
        <>
          <div role="group" aria-label="Chart view" className="flex gap-1">
            {(
              [
                ["line", "Net worth"],
                ["changes", "Changes"],
              ] as const
            ).map(([key, words]) => (
              <button
                key={key}
                type="button"
                data-net-worth-view={key}
                aria-pressed={mode === key}
                onClick={() => {
                  setMode(key);
                  setScrub(null);
                  setFocusDot(null);
                  shut();
                  try {
                    window.localStorage.setItem(CHART_VIEW_STORAGE_KEY, key);
                  } catch {
                    // Not remembered: it still switches.
                  }
                }}
                className={`inline-flex min-h-11 items-center justify-center border px-3 text-sm font-medium ${
                  mode === key
                    ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                    : "border-zinc-300 text-zinc-600 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {words}
              </button>
            ))}
          </div>
          <div
            ref={area}
            className="nw-area relative"
            data-unmeasured={measured ? undefined : ""}
            style={{ minHeight: place?.height ?? H }}
          >
            <div
              ref={box}
              data-net-worth-plot=""
              data-unmeasured={measured ? undefined : ""}
              // Scrubbing is choosing a day: a slider, its value the day and the net worth then.
              role="slider"
              tabIndex={0}
              aria-label={`Net worth, ${windowWords.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={shown.length - 1}
              aria-valuenow={at}
              aria-valuetext={`${at === shown.length - 1 ? "Today" : dayLabel(point.date, { year: true })}: ${figureShown ? dollars(point.cents) : "hidden"}`}
              className={`nw-box relative -mx-1 cursor-crosshair outline-offset-4 select-none ${expanded ? "touch-none" : "touch-pan-y"}`}
              style={{ height: H }}
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") {
                  fingers.current.set(e.pointerId, e.clientX);
                  if (fingers.current.size === 2) {
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
                if (e.pointerType === "mouse" && e.button === 0) {
                  selecting.current = { x: e.clientX, moved: false };
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // The drag still follows inside the chart.
                  }
                }
                setScrub(indexAt(e.clientX));
              }}
              onPointerMove={(e) => {
                const drag = selecting.current;
                if (drag && e.pointerType === "mouse") {
                  const r = e.currentTarget.getBoundingClientRect();
                  if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
                  if (drag.moved)
                    setSel({
                      a: Math.max(gutter, drag.x - r.left),
                      b: Math.max(gutter, e.clientX - r.left),
                    });
                }
                if (e.pointerType !== "mouse" && fingers.current.has(e.pointerId)) {
                  fingers.current.set(e.pointerId, e.clientX);
                  if (pinch.current && fingers.current.size === 2) {
                    const [a, b] = [...fingers.current.values()];
                    const r = e.currentTarget.getBoundingClientRect();
                    const factor = pinch.current.distance / Math.max(1, Math.abs(a - b));
                    const share = shareOf((a + b) / 2, r);
                    zoomTo(zoomWindow(pinch.current.view, total, factor, share));
                    return;
                  }
                }
                if (e.pointerType === "mouse" || dragging.current) setScrub(indexAt(e.clientX));
              }}
              onPointerUp={(e) => {
                const drag = selecting.current;
                selecting.current = null;
                setSel(null);
                if (drag?.moved && e.pointerType === "mouse") {
                  // The days under the drag, zoomed into (at least MIN_DAYS), the axis refit.
                  const [i, j] = [dayAt(drag.x), dayAt(e.clientX)].sort((p, q) => p - q);
                  justSelected.current = true;
                  // A drag at the last day keeps the day before it too.
                  const from = Math.min(win.from + i, total - MIN_DAYS);
                  zoomTo({
                    from,
                    to: Math.min(total - 1, Math.max(win.from + j, from + MIN_DAYS - 1)),
                  });
                }
                fingers.current.delete(e.pointerId);
                if (fingers.current.size < 2) pinch.current = null;
                if (e.pointerType !== "mouse") {
                  dragging.current = false;
                  setScrub(null);
                }
              }}
              onPointerCancel={(e) => {
                selecting.current = null;
                setSel(null);
                fingers.current.delete(e.pointerId);
                pinch.current = null;
                dragging.current = false;
                setScrub(null);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setScrub(null);
              }}
              onClick={(e) => {
                // A drag that selected days is not a click on a dot.
                if (justSelected.current) {
                  justSelected.current = false;
                  return;
                }
                // A tap or click on a movement's dot opens it.
                if (!layout) return;
                const r = e.currentTarget.getBoundingClientRect();
                const i = layout.hit(e.clientX - r.left, e.clientY - r.top);
                if (i === null) return;
                setDetails(false);
                setFocusDot(i);
                setOpened({ kind: "dot", index: i, key: `dot:${i}` });
              }}
              onDoubleClick={() => {
                if (view) resetView();
              }}
              onBlur={() => setScrub(null)}
              onKeyDown={(e) => {
                const from = scrub ?? shown.length - 1;
                const jump = e.shiftKey ? 7 : 1;
                // Zoomed in, Alt + an arrow moves the days in view (a quarter of them).
                if (view && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  const quarter = Math.max(1, Math.round((win.to - win.from) / 4));
                  zoomTo(panWindow(win, total, e.key === "ArrowLeft" ? -quarter : quarter));
                } else if (e.key === "ArrowLeft") setScrub(Math.max(0, stepFrom(from, -jump)));
                else if (e.key === "ArrowRight") {
                  const next = stepFrom(from, jump);
                  setScrub(next >= shown.length - 1 ? null : next);
                } else if (e.key === "Home") setScrub(0);
                else if (e.key === "End" || e.key === "Escape") setScrub(null);
                else if (e.key === "+" || e.key === "=") zoomBy(0.5);
                else if (e.key === "-") zoomBy(2);
                else if (e.key === "0" && view) resetView();
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
                {/* Whatever is drawn stays on the chart (a little room for the dots and the line's
                    width), also while the scale eases to a new fit. */}
                <clipPath id={clipId}>
                  <rect x={-6} y={-6} width={width + 12} height={H + 12} />
                </clipPath>
                <g clipPath={`url(#${clipId})`}>
                  {changes && barScale && (
                    // One bar per period: up from the zero line, down below it. Each carries its
                    // change in cents (data-change) and the period it covers.
                    <g data-net-worth-bars="" data-period={bars[0]?.period}>
                      {bars.map((b, k) => {
                        const gap = slot > 4 ? 1.5 : 0;
                        const top = Math.min(barScale.y(b.change), barScale.zero);
                        const h = Math.abs(barScale.y(b.change) - barScale.zero);
                        return (
                          <rect
                            key={b.from}
                            data-net-worth-bar=""
                            data-change={b.change}
                            data-from={b.from}
                            x={gutter + k * slot + gap / 2}
                            y={top}
                            width={Math.max(1, slot - gap)}
                            height={h}
                            className={`fill-current ${
                              activeBar && activeBar !== b ? "opacity-40" : ""
                            }`}
                          />
                        );
                      })}
                    </g>
                  )}
                  {/* Where the range started. */}
                  {!changes && (
                    <line
                      x1={gutter}
                      x2={width}
                      y1={yDay(0)}
                      y2={yDay(0)}
                      strokeWidth={1}
                      strokeDasharray="2 5"
                      className="stroke-zinc-400 dark:stroke-zinc-600"
                    />
                  )}
                  {!changes && (
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
                  )}
                  {scrub !== null && !changes && (
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
                        cy={yDay(at)}
                        r={4.5}
                        strokeWidth={2}
                        className={`fill-white dark:fill-zinc-950 ${stroke}`}
                      />
                    </>
                  )}
                  {scrub === null && !changes && (
                    <circle
                      cx={x(shown.length - 1)}
                      cy={yDay(shown.length - 1)}
                      r={3.5}
                      className="fill-current"
                    />
                  )}
                </g>
              </svg>
              {sel && (
                <div
                  aria-hidden="true"
                  data-net-worth-selection=""
                  className="pointer-events-none absolute inset-y-0 bg-zinc-950/10 dark:bg-zinc-50/10"
                  style={{ left: Math.min(sel.a, sel.b), width: Math.abs(sel.b - sel.a) }}
                />
              )}
              {layout && !changes && (
                <MovementDots
                  ref={dotsRef}
                  counts={expanded}
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
              <Scale
                height={H}
                ticks={changes ? barTicks : ticks}
                y={changes && barScale ? barScale.y : y}
                zero={changes && barScale ? barScale.zero : lo < 0 && hi > 0 ? y(0) : null}
                amounts={figureShown}
              />
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
                  aria-label={`${dayLabel(group.date, { year: true })}: ${group.events
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
                    top: yDay(i) - MARK / 2,
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
                  {/* No "×N" here: on nearly every dot it made the chart busy (demo-video list);
                      the outline says there are several, and the open chart counts them. */}
                </button>
              ))}
              {open && place && (
                <>
                  <DaySummary
                    ref={summaryBox}
                    group={open.group}
                    worth={figureShown ? worthOn(open.group) : undefined}
                    title={open.title}
                    at={place.summary}
                    details={details}
                    onDetails={() => setDetails((d) => !d)}
                    onClose={shut}
                  />
                  {details && narrow && (
                    <DetailsSheet
                      group={open.group}
                      title={open.title}
                      onClose={() => setDetails(false)}
                    />
                  )}
                  {details && !narrow && place.detail && (
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

          {changes && (
            <p data-net-worth-caption="" className="text-xs text-zinc-600 dark:text-zinc-400">
              One bar per {bars[0]?.period ?? "day"}: how much net worth went up or down. Bar
              heights are compressed so small and large changes both show; the labels are the real
              amounts.
            </p>
          )}

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
            {zoomed && (
              <button
                type="button"
                data-net-worth-reset=""
                onClick={resetView}
                className="ml-auto inline-flex min-h-11 items-center px-3 text-sm font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Reset
                <span className="sr-only"> the zoom to the range</span>
              </button>
            )}
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
  return first === last
    ? dayLabel(first, { year: true })
    : `${dayLabel(first, { year: true })} to ${dayLabel(last, { year: true })}`;
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
  counts,
}: {
  ref: React.RefObject<HTMLCanvasElement | null>;
  // "×N" beside a dot of several: in the open chart only. On Home's card it was on nearly
  // every dot (demo-video list); the larger square already says there are several.
  counts: boolean;
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
      if (counts && d.events.length > 1) {
        ctx.fillStyle = ink;
        ctx.fillText(`×${d.events.length}`, d.x + 5, d.y + 11);
      }
      if (i === focus) {
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(d.x - 8, d.y - 8, 16, 16);
        ctx.setLineDash([]);
      }
    });
  }, [ref, dots, width, height, selected, focus, counts]);

  return (
    <canvas
      ref={ref}
      data-net-worth-dots=""
      data-counts={counts ? "" : undefined}
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
        <span aria-hidden="true">−</span>
        <span className="sr-only">Zoom out</span>
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
        className="relative h-8 min-w-0 flex-1 touch-none border border-zinc-300 outline-offset-2 select-none dark:border-zinc-700"
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
        <span aria-hidden="true">+</span>
        <span className="sr-only">Zoom in</span>
      </button>
    </div>
  );
}

// A day's summary: what moved the money, a line each (at most SUMMARY_LINES, then "+N more"),
// More details and close. Inside the chart, where placeBoxes put it.
// What the line's heights are worth (QA round 31: with no scale, a card-only person's line, all
// below zero, read as dipping under $0 and spiking above it against the dashed start line). The
// highest and lowest in view at the left, the start line's amount at the right, and $0 drawn
// when the line crosses it. Not read out: the slider says each day's figure.
function Scale({
  height,
  ticks,
  y,
  zero,
  amounts,
}: {
  // Off while the figure is hidden: the labels would give it away.
  amounts: boolean;
  height: number;
  // The axis labels, in cents (niceTicks): a few round amounts across the range on screen.
  ticks: number[];
  y: (cents: number) => number;
  zero: number | null;
}) {
  const label =
    "pointer-events-none absolute bg-white/80 px-0.5 text-[10px] leading-none text-zinc-500 tabular-nums dark:bg-zinc-950/80";
  // While the scale eases to a new fit a label's height can be off the chart: it waits there.
  const on = (cents: number) => y(cents) >= 6 && y(cents) <= height - 6;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {zero !== null && (
        <>
          <div
            data-net-worth-zero=""
            className="absolute right-0 left-0 border-t border-zinc-400 dark:border-zinc-500"
            style={{ top: zero }}
          />
          <span data-net-worth-scale="zero" className={label} style={{ top: zero + 2, right: 2 }}>
            $0
          </span>
        </>
      )}
      {amounts &&
        ticks
          .filter((t) => on(t) && !(zero !== null && t === 0))
          .map((t) => (
            <span
              key={t}
              data-net-worth-scale="tick"
              className={label}
              style={{ top: y(t) - 5, left: 2 }}
            >
              {dollars(t)}
            </span>
          ))}
    </div>
  );
}

// A dot's days: its last, and the link to its transactions (one day, or the days it holds).
const lastDate = (g: EventGroup) =>
  g.events.reduce((last, e) => (e.date > last ? e.date : last), g.date);
export function transactionsHref(g: EventGroup): string {
  const first = g.events.reduce((d, e) => (e.date < d ? e.date : d), g.date);
  const last = lastDate(g);
  return first === last ? `/transactions?day=${first}` : `/transactions?from=${first}&to=${last}`;
}

function DaySummary({
  ref,
  group,
  worth,
  title,
  at,
  details,
  onDetails,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  group: EventGroup;
  // Net worth at the end of that day, from the line.
  worth?: number;
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
          <span aria-hidden="true">×</span>
          <span className="sr-only">Close</span>
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
      {worth !== undefined && (
        <p data-net-worth-day-worth="" className="tabular-nums">
          Net worth then: <span className="font-semibold">{dollars(worth)}</span>
        </p>
      )}
      <Link
        href={transactionsHref(group)}
        data-net-worth-day-link=""
        className="self-start font-semibold hover:underline"
      >
        {group.events.some((e) => e.date !== group.date)
          ? "See these days' transactions"
          : "See that day's transactions"}
      </Link>
      <button
        type="button"
        aria-expanded={details}
        aria-controls={details ? "net-worth-day-details" : undefined}
        onClick={onDetails}
        className="self-start font-medium underline underline-offset-4"
      >
        {details ? "Less" : "More details"}
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
      className="nw-box-in pointer-events-auto absolute z-10 flex flex-col gap-2 border-2 border-current bg-white p-2 text-xs shadow-lg dark:bg-zinc-950"
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <DetailsBody group={group} title={title} onClose={onClose} />
    </div>
  );
}

// On a phone, More details is a sheet from the bottom of the screen over a dimmed page (QA round
// 9: in the chart it ran past the screen, under the chat's button). Esc, [X] or a tap on the page
// above shuts it.
function DetailsSheet({
  group,
  title,
  onClose,
}: {
  group: EventGroup;
  title: string;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);
  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[60] bg-zinc-950/40" />
      <div
        ref={sheet}
        id="net-worth-day-details"
        role="dialog"
        aria-label={`Every movement on ${title}`}
        tabIndex={-1}
        data-net-worth-event-detail=""
        data-sheet-details=""
        className="nw-sheet-in fixed inset-x-0 bottom-0 z-[61] flex max-h-[70vh] flex-col gap-2 overflow-y-auto border-t-2 border-current bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm shadow-2xl outline-none dark:bg-zinc-950"
      >
        <DetailsBody group={group} title={title} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

function DetailsBody({
  group,
  title,
  onClose,
}: {
  group: EventGroup;
  title: string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold"># {title}</p>
        <button
          type="button"
          onClick={onClose}
          className="-my-1 inline-flex min-h-8 items-center font-semibold hover:underline"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Close the details</span>
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {group.events.map((e, k) => (
          <li
            key={k}
            className="flex flex-col border-t border-zinc-300 pt-1 first:border-0 first:pt-0 dark:border-zinc-700"
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
              {[EVENT_KIND_WORDS[e.kind], e.account, dayLabel(e.date, { year: true })]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-2 border-t border-current pt-1 font-semibold tabular-nums">
        <span>{group.events.some((e) => e.date !== group.date) ? "Together" : "That day"}</span>
        <span>{group.cents === 0 ? "No change" : signed(group.cents)}</span>
      </p>
    </>
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
      <MarchingPath d={d} />
    </svg>
  );
}
