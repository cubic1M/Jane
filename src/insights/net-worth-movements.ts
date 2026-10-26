import type { EventKind, NetWorthEvent } from "./net-worth-events";
import { DAY_MS } from "@/lib/dates";

// Every movement on the expanded net worth chart (founder: "the expansion of the networth graph
// should have a dot for EVERY single little movement in cash, so you can zoom in on each to know
// where the money went"). Pure: how the movements travel (compactly, thousands of them), where
// each dot goes at the current zoom, which overlap and are drawn as one (×N) until zooming in
// splits them, and which one a tap or click lands on.

// --- On the wire: a row per movement, its strings in shared tables ---

export type MovementWire = {
  // Days since `from`, so a row is a few small numbers.
  from: string;
  strings: string[];
  // [day, cents, moved, kind, label, name, account, href]: the last four index `strings` (−1 for
  // none), kind indexes KINDS.
  rows: [number, number, number, number, number, number, number, number][];
};

const KINDS: readonly EventKind[] = [
  "pay",
  "purchase",
  "bill",
  "card_payment",
  "loan_paid_off",
  "investments",
  "refund",
  "jane_saved",
  "transfer",
];

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function encodeMovements(from: string, events: readonly NetWorthEvent[]): MovementWire {
  const strings: string[] = [];
  const at = new Map<string, number>();
  const ref = (s: string | undefined) => {
    if (s === undefined) return -1;
    let i = at.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      at.set(s, i);
    }
    return i;
  };
  const start = dayNumber(from);
  return {
    from,
    strings,
    rows: events.map((e) => [
      dayNumber(e.date) - start,
      e.cents,
      e.moved ?? 0,
      KINDS.indexOf(e.kind),
      ref(e.label),
      ref(e.name),
      ref(e.account),
      ref(e.href),
    ]),
  };
}

export function decodeMovements(wire: MovementWire): NetWorthEvent[] {
  const start = dayNumber(wire.from);
  const str = (i: number) => (i < 0 ? undefined : wire.strings[i]);
  return wire.rows.map(([day, cents, moved, kind, label, name, account, href]) => ({
    date: isoOf(start + day),
    kind: KINDS[kind] ?? "purchase",
    label: str(label) ?? "",
    cents,
    ...(moved ? { moved } : {}),
    ...(str(name) ? { name: str(name) } : {}),
    ...(str(account) ? { account: str(account) } : {}),
    href: str(href) ?? "/transactions",
  }));
}

// --- On the chart: a dot each, spread through its day when there's room, overlaps grouped ---

// Two dots closer than this (px) are drawn as one, ×N, until zooming in parts them.
export const DOT_GAP = 9;
// On a phone's narrow chart a dot and its ×N label need more room: QA round 9 found them piled
// on each other across the full range at 375px.
export const DOT_GAP_NARROW = 16;

export type Dot = {
  x: number;
  y: number;
  // The movements under this dot (one, or the ones that overlap at this zoom), in date order.
  events: NetWorthEvent[];
};

// Where every movement in view goes. `days` are the chart's points in view (one a day), `x` and
// `y` place a point. A day's movements spread across the day's own slot (half-way to the day on
// each side, inside the chart), on the line there, when the slot is wide enough for each to have
// its own dot; otherwise they sit on the day. Then dots that overlap at this zoom become one.
export function layoutDots({
  events,
  days,
  x,
  y,
  gap = DOT_GAP,
}: {
  events: readonly NetWorthEvent[];
  days: readonly { date: string; cents: number }[];
  x: (i: number) => number;
  y: (cents: number) => number;
  gap?: number;
}): Dot[] {
  if (days.length === 0) return [];
  const index = new Map(days.map((d, i) => [d.date, i]));
  const byDay = new Map<number, NetWorthEvent[]>();
  for (const e of events) {
    const i = index.get(e.date);
    if (i === undefined) continue;
    const list = byDay.get(i);
    if (list) list.push(e);
    else byDay.set(i, [e]);
  }
  const last = days.length - 1;
  const step = days.length > 1 ? x(1) - x(0) : 0;
  const left = Math.min(x(0), x(last));
  const right = Math.max(x(0), x(last));
  // The line's height at any x: between the two days either side of it.
  const lineAt = (px: number) => {
    if (step === 0) return y(days[0].cents);
    const u = Math.min(last, Math.max(0, (px - x(0)) / step));
    const i = Math.floor(u);
    const j = Math.min(last, i + 1);
    return y(days[i].cents + (days[j].cents - days[i].cents) * (u - i));
  };
  const raw: Dot[] = [];
  for (const [i, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(left, x(i) - step / 2);
    const to = Math.min(right, x(i) + step / 2);
    const spread = list.length > 1 && (to - from) / list.length >= gap;
    list.forEach((e, k) => {
      const px = spread ? from + ((k + 0.5) / list.length) * (to - from) : x(i);
      raw.push({ x: px, y: spread ? lineAt(px) : y(days[i].cents), events: [e] });
    });
  }
  // By pixel: a dot within `gap` of a group (across and up or down) joins it, found through a
  // grid of gap-sized cells; again until no two groups are that close (a group's centre moves as
  // it grows).
  let dots = raw.sort((a, b) => a.x - b.x);
  for (let pass = 0; pass < 6; pass++) {
    const next = groupByPixel(dots, gap);
    if (next.length === dots.length) break;
    dots = next;
  }
  return dots;
}

function groupByPixel(dots: readonly Dot[], gap: number): Dot[] {
  const out: Dot[] = [];
  const cells = new Map<string, number[]>();
  const cell = (cx: number, cy: number) => `${cx},${cy}`;
  for (const d of dots) {
    const cx = Math.floor(d.x / gap);
    const cy = Math.floor(d.y / gap);
    let near = -1;
    let best = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const k of cells.get(cell(i, j)) ?? []) {
          const g = out[k];
          const dx = Math.abs(g.x - d.x);
          const dy = Math.abs(g.y - d.y);
          if (dx < gap && dy < gap && dx + dy < best) {
            best = dx + dy;
            near = k;
          }
        }
    if (near >= 0) {
      const g = out[near];
      const n = g.events.length;
      const m = d.events.length;
      g.x = (g.x * n + d.x * m) / (n + m);
      g.y = (g.y * n + d.y * m) / (n + m);
      g.events.push(...d.events);
      g.events.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      out.push({ x: d.x, y: d.y, events: [...d.events] });
      const key = cell(cx, cy);
      const list = cells.get(key);
      if (list) list.push(out.length - 1);
      else cells.set(key, [out.length - 1]);
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

// Which dot is at a point: a grid of cells over the chart, so a tap checks a few dots, not all
// of them (thousands when the whole history is in view).
export function dotIndex(dots: readonly Dot[], cell = 24) {
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  dots.forEach((d, i) => {
    const k = key(Math.floor(d.x / cell), Math.floor(d.y / cell));
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  return (px: number, py: number, radius = 12): number | null => {
    let best: number | null = null;
    let bestD = radius * radius;
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const i of grid.get(key(gx, gy)) ?? []) {
          const dx = dots[i].x - px;
          const dy = dots[i].y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD) {
            bestD = d2;
            best = i;
          }
        }
      }
    }
    return best;
  };
}

// --- Zoom: the window of days in view ---

// The fewest days the chart zooms in to: two, so each day has half the chart, room enough for
// every movement in it to have its own dot even on a phone (18 at DOT_GAP on a 330px chart).
export const MIN_DAYS = 2;

export type ViewWindow = { from: number; to: number };

// Zoomed by `factor` (under 1 is in) around `at` (a share across the chart, 0 to 1), kept inside
// the history and at least MIN_DAYS wide.
export function zoomWindow(view: ViewWindow, total: number, factor: number, at = 0.5): ViewWindow {
  const last = total - 1;
  const span = view.to - view.from;
  const next = Math.min(last, Math.max(MIN_DAYS - 1, Math.round(span * factor)));
  const centre = view.from + span * at;
  let from = Math.round(centre - next * at);
  from = Math.max(0, Math.min(from, last - next));
  return { from, to: from + next };
}

// Moved by `days` (negative is back), kept inside the history.
export function panWindow(view: ViewWindow, total: number, days: number): ViewWindow {
  const span = view.to - view.from;
  const from = Math.max(0, Math.min(view.from + Math.round(days), total - 1 - span));
  return { from, to: from + span };
}
