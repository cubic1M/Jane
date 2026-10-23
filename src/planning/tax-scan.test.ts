import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/detectors/contract";
import { monthFor, taxFound } from "./tax-scan";

// Spec step 273: every tax suggestion on the calendar, in its month, ranked with the rest.

const s = (over: Partial<Suggestion>): Suggestion =>
  ({
    id: `${over.capability}:${over.topic}`,
    capability: "taxes",
    topic: "year_end_moves",
    title: "t",
    headline: "Do it, save $100",
    short: "1",
    worthCents: 10_000,
    worthKind: "saves",
    confidence: { percent: 60, reason: "r" },
    urgency: "later",
    why: "w",
    action: { label: "a", href: "/taxes" },
    ...over,
  }) as Suggestion;

describe("the month a tax suggestion goes in", () => {
  it("is its own month when it can wait, this month when urgent, soon within a month", () => {
    expect(monthFor("year_end_moves", "later", 10)).toBe(12);
    expect(monthFor("s_corp_election", "later", 10)).toBe(2);
    expect(monthFor("s_corp_election", "now", 10)).toBe(10);
    // Soon: its month when that's this month or next, otherwise next month.
    expect(monthFor("irmaa_watch", "soon", 10)).toBe(10);
    expect(monthFor("childcare_tax_break", "soon", 10)).toBe(11);
    expect(monthFor("year_end_moves", "soon", 10)).toBe(11);
    expect(monthFor("estimated_taxes", "soon", 12)).toBe(1);
  });
});

describe("tax suggestions ranked with the rest of the scan", () => {
  it("keeps the tax ones, with their place among everything", () => {
    const all = [
      s({ capability: "spending", topic: "subscriptions", worthCents: 50_000 }),
      s({ topic: "year_end_moves", worthCents: 20_000 }),
      s({ topic: "irmaa_watch", worthCents: 120_000, worthKind: "risk", urgency: "soon" }),
    ];
    const found = taxFound(all, 10);
    expect(found.map((f) => f.topic)).toEqual(
      expect.arrayContaining(["year_end_moves", "irmaa_watch"]),
    );
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.rank >= 1 && f.rank <= 3)).toBe(true);
    expect(new Set(found.map((f) => f.rank)).size).toBe(2);
    expect(found.find((f) => f.topic === "irmaa_watch")!.month).toBe(10);
  });

  it("marks recommendations as demo advice and facts as not", () => {
    const found = taxFound(
      [s({ topic: "roth_conversion" }), s({ topic: "irmaa_watch", worthKind: "risk" })],
      10,
    );
    expect(Object.fromEntries(found.map((f) => [f.topic, f.advice]))).toEqual({
      roth_conversion: true,
      irmaa_watch: false,
    });
  });
});
