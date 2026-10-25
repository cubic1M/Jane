import { describe, expect, it } from "vitest";
import { movementOf, type NetWorthEvent } from "./net-worth-events";
import {
  DOT_GAP,
  MIN_DAYS,
  decodeMovements,
  dotIndex,
  encodeMovements,
  layoutDots,
  panWindow,
  zoomWindow,
} from "./net-worth-movements";

// Every movement on the expanded net worth chart (founder: "a dot for EVERY single little
// movement in cash, so you can zoom in on each to know where the money went").

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const days = Array.from({ length: 90 }, (_, i) => ({ date: day(i), cents: 1_000_000 + i * 1_000 }));
const event = (n: number, k: number): NetWorthEvent => ({
  date: day(n),
  kind: "purchase",
  label: `Bought: Shop ${n}-${k}`,
  cents: -(1_000 + k),
  href: `/transactions?q=Shop`,
  name: `Shop ${n}-${k}`,
  account: "Checking ····0000",
});
// Five movements a day, every day.
const events = days.flatMap((_, n) => [0, 1, 2, 3, 4].map((k) => event(n, k)));

const place = (from: number, to: number, width: number) => {
  const shown = days.slice(from, to + 1);
  return layoutDots({
    events,
    days: shown,
    x: (i) => (i / Math.max(1, shown.length - 1)) * width,
    y: (v) => 300 - (v - 1_000_000) / 1_000,
  });
};

describe("every movement", () => {
  it("is every transaction: transfers between the person's own accounts included", () => {
    const base = {
      date: day(0),
      name: "To Savings",
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: null,
    };
    expect(movementOf({ ...base, amountCents: 50_000, accountType: "depository" })).toMatchObject({
      kind: "transfer",
      cents: 0,
      moved: 50_000,
      label: "Moved out: To Savings",
    });
    // A card payment seen from the card's side, too.
    expect(
      movementOf({
        ...base,
        name: "Payment thank you",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        amountCents: -30_000,
        accountType: "credit",
      }),
    ).toMatchObject({ kind: "card_payment", moved: 30_000 });
  });

  it("travels compactly and comes back the same", () => {
    const wire = encodeMovements(day(0), events);
    expect(wire.rows).toHaveLength(events.length);
    // Shared strings: the account and the link once each.
    expect(wire.strings.filter((s) => s === "Checking ····0000")).toHaveLength(1);
    expect(decodeMovements(wire)).toEqual(events);
  });
});

describe("the dots at each zoom", () => {
  it("gives every movement its own dot at day zoom, none overlapping", () => {
    const dots = place(40, 40 + MIN_DAYS - 1, 360);
    const inView = events.filter((e) => e.date >= day(40) && e.date <= day(40 + MIN_DAYS - 1));
    expect(dots).toHaveLength(inView.length);
    expect(dots.every((d) => d.events.length === 1)).toBe(true);
    const sorted = [...dots].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const apart = Math.hypot(sorted[i].x - sorted[i - 1].x, sorted[i].y - sorted[i - 1].y);
      expect(apart).toBeGreaterThanOrEqual(DOT_GAP);
    }
  });

  it("groups only what overlaps when zoomed out, and every movement is in exactly one dot", () => {
    const dots = place(0, days.length - 1, 360);
    expect(dots.length).toBeLessThan(events.length);
    expect(dots.some((d) => d.events.length > 1)).toBe(true);
    expect(dots.reduce((n, d) => n + d.events.length, 0)).toBe(events.length);
  });

  it("finds the dot under a tap from the grid, not by checking them all", () => {
    const dots = place(40, 42, 360);
    const hit = dotIndex(dots);
    const target = dots[7];
    expect(hit(target.x + 3, target.y - 2)).toBe(7);
    expect(hit(target.x + 200, target.y + 200)).toBeNull();
  });
});

describe("the window of days in view", () => {
  const all = { from: 0, to: 89 };
  it("zooms in around the pointer and never past a few days", () => {
    // Around the right edge: it stays on today.
    const half = zoomWindow(all, 90, 0.5, 1);
    expect(half.to).toBe(89);
    expect(half.to - half.from).toBe(Math.round(89 * 0.5));
    let w = all;
    for (let i = 0; i < 20; i++) w = zoomWindow(w, 90, 0.5, 0.5);
    expect(w.to - w.from + 1).toBe(MIN_DAYS);
    expect(w.from).toBeGreaterThanOrEqual(0);
  });

  it("zooms out to the whole history and pans inside it", () => {
    expect(zoomWindow({ from: 40, to: 50 }, 90, 100, 0.5)).toEqual(all);
    expect(panWindow({ from: 80, to: 89 }, 90, 30)).toEqual({ from: 80, to: 89 });
    expect(panWindow({ from: 10, to: 19 }, 90, -30)).toEqual({ from: 0, to: 9 });
  });
});
