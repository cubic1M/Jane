import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { aheadTiles, deadlineSummary, type AheadData } from "./ahead";

// The Ahead hub's pure helpers (spec step 80).

const FULL: AheadData = {
  asOf: "2026-10-18",
  yearly: { monthlyCents: 69_00, bills: 3 },
  deadlines: { next: { title: "Duolingo renews", date: "2026-10-22" }, soon: 7 },
  debt: { accounts: 3, owedCents: 38_775_50 },
  lifeEvents: { open: 2, newest: { title: "Moving", done: 2, total: 8 } },
};

const EMPTY: AheadData = {
  asOf: "2026-10-18",
  yearly: { monthlyCents: 0, bills: 0 },
  deadlines: { next: null, soon: 0 },
  debt: { accounts: 0, owedCents: 0 },
  lifeEvents: { open: 0, newest: null },
};

const byLabel = (data: AheadData) =>
  Object.fromEntries(
    aheadTiles(data)
      .flatMap((g) => g.tiles)
      .map((t) => [t.label, t]),
  );

describe("deadlineSummary", () => {
  const d = (title: string, date: string) => ({ title, date });

  it("finds the next deadline from today and counts the next 30 days", () => {
    expect(
      deadlineSummary(
        [
          d("Passed one", "2026-10-10"),
          d("Later", "2026-12-01"),
          d("B renews", "2026-10-20"),
          d("A renews", "2026-10-20"),
          d("Edge", "2026-11-17"),
          d("Just past the edge", "2026-11-18"),
        ],
        "2026-10-18",
      ),
    ).toEqual({ next: { title: "A renews", date: "2026-10-20" }, soon: 3 });
  });

  it("counts today, and is empty with nothing ahead", () => {
    expect(deadlineSummary([d("Today", "2026-10-18")], "2026-10-18")).toEqual({
      next: { title: "Today", date: "2026-10-18" },
      soon: 1,
    });
    expect(deadlineSummary([d("Gone", "2026-01-01")], "2026-10-18")).toEqual({
      next: null,
      soon: 0,
    });
  });
});

describe("aheadTiles", () => {
  it("groups every planning page", () => {
    expect(aheadTiles(FULL).map((g) => [g.title, g.tiles.map((t) => t.href)])).toEqual([
      ["Coming up", ["/deadlines", "/budgets#yearly", "/debt"]],
      ["Get ready", ["/afford", "/life-events", "/tax-pack"]],
      ["Look back", ["/check-in", "/year"]],
    ]);
  });

  it("shows a live line where there's data", () => {
    const t = byLabel(FULL);
    expect(t["Yearly bills"]).toMatchObject({ value: "$69.00 a month" });
    expect(t["Deadlines"]).toMatchObject({
      value: "7 in 30 days",
      status: "Next: Duolingo renews, in 4 days",
    });
    expect(t["Paying off debt"]).toMatchObject({
      value: "$38,775.50",
      status: "On 3 cards and loans",
    });
    expect(t["Life events"]).toMatchObject({
      value: "2 of 8 done",
      status: "Moving, and 1 more checklist",
    });
    expect(t["Tax-time pack"]).toMatchObject({ value: "2026" });
    expect(t["Monthly check-in"]).toMatchObject({ status: "How September 2026 went" });
    expect(t["Year in review"]).toMatchObject({ value: "2026" });
  });

  it("names a single open checklist and a single card", () => {
    const t = byLabel({
      ...FULL,
      debt: { accounts: 1, owedCents: 100_00 },
      lifeEvents: { open: 1, newest: { title: "New job", done: 0, total: 6 } },
    });
    expect(t["Paying off debt"].status).toBe("On 1 card or loan");
    expect(t["Life events"].status).toBe("New job checklist");
  });

  it("shows the tax year before mid-April as last year's", () => {
    expect(byLabel({ ...EMPTY, asOf: "2027-02-01" })["Tax-time pack"].value).toBe("2026");
  });

  it("has a friendly empty state for every tile", () => {
    const t = byLabel(EMPTY);
    expect(t["Yearly bills"]).toMatchObject({ href: "/budgets", value: null });
    expect(t["Deadlines"]).toMatchObject({ value: null, status: "Nothing coming up" });
    expect(t["Paying off debt"]).toMatchObject({ value: null });
    expect(t["Life events"]).toMatchObject({ value: null });
    expect(Object.keys(t)).toHaveLength(8);
  });

  it("never gives advice or recommends in its copy", () => {
    for (const data of [FULL, EMPTY]) {
      for (const tile of aheadTiles(data).flatMap((g) => g.tiles)) {
        const text = `${tile.status}.`;
        expect(recommendsAChoice(text), text).toBe(false);
        const figures = dollarFigures(text).map((f) => f.cents);
        expect(checkGuardrails(text, figures), text).toEqual({ ok: true });
      }
    }
  });
});
