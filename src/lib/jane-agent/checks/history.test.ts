import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  appendEntry,
  dropOf,
  entryOf,
  meetsBar,
  metricsOf,
  nightlyTable,
  withNightlyTable,
  type NightEntry,
} from "./history";
import { rotated, type CheckRun } from "./run";
import type { CheckQuestion } from "./bank";

// Spec step 195: the nightly record, a drop noticed, and the rotating share of the bank.

const night = (over: Partial<NightEntry>): NightEntry => ({
  date: "2026-10-19",
  mode: "full",
  promptVersion: "chat-v9",
  score: 95,
  graded: 20,
  skipped: 0,
  costCents: 8,
  firstWordsMs: 900,
  failed: [],
  ...over,
});

describe("the nightly record", () => {
  it("keeps the failing questions, worst first, without answers", () => {
    const run = {
      mode: "full",
      promptVersion: "chat-v9",
      score: 88,
      graded: 3,
      skipped: 1,
      costCents: 7.5,
      firstWordsMs: { median: 700, max: 1200 },
      results: [
        { id: "a", text: "A?", status: "graded", score: 100, reason: "ok", answer: "secret" },
        {
          id: "b",
          text: "B?",
          status: "graded",
          score: 60,
          reason: "Missing $1.",
          answer: "secret",
        },
        { id: "c", text: "C?", status: "graded", score: 30, reason: "Wrong.", answer: "secret" },
        { id: "d", text: "D?", status: "skipped", reason: "x" },
      ],
    } as unknown as CheckRun;
    const entry = entryOf(run, "2026-10-19");
    expect(entry.failed.map((f) => f.id)).toEqual(["c", "b"]);
    expect(JSON.stringify(entry)).not.toContain("secret");
    expect(entry.firstWordsMs).toBe(700);
  });

  it("calls a fall a drop only against the same kind of run", () => {
    const history = [
      night({ date: "2026-10-17", score: 95 }),
      night({ date: "2026-10-18", mode: "rules_only", score: 100 }),
    ];
    expect(dropOf(history, night({ date: "2026-10-19", score: 90 }))).toMatch(
      /fell from 95 \(2026-10-17\) to 90/,
    );
    expect(dropOf(history, night({ date: "2026-10-19", score: 94 }))).toBeNull();
    expect(dropOf(history, night({ date: "2026-10-19", mode: "rules_only", score: 95 }))).toMatch(
      /rules-only/,
    );
    expect(dropOf([], night({}))).toBeNull();
  });

  it("replaces a night's own entry and writes the table between the markers", () => {
    const first = appendEntry([], night({ score: 90 }));
    const again = appendEntry(first, night({ score: 92 }));
    expect(again).toHaveLength(1);
    expect(again[0].score).toBe(92);
    const doc = withNightlyTable("# Chat quality\n", again);
    expect(doc).toContain("<!-- nightly:start -->");
    expect(doc).toMatch(/\| 2026-10-19 \| with Claude \|.* 92 \|/);
    expect(
      withNightlyTable(doc, appendEntry(again, night({ date: "2026-10-20", score: 93 }))),
    ).toMatch(/2026-10-20[\s\S]*2026-10-19/);
    expect(nightlyTable([])).toMatch(/No nightly run/);
  });
});

describe("the rotating share of the bank", () => {
  const q = (id: string, needs: "rules" | "claude"): CheckQuestion[] => [
    { id, text: id, needs, expect: {} },
  ];
  const bank = [
    q("r1", "rules"),
    q("c1", "claude"),
    q("c2", "claude"),
    q("c3", "claude"),
    q("c4", "claude"),
  ];

  it("always runs the rules questions and moves a window of the Claude ones along the bank", () => {
    const ids = (day: number) => rotated(bank, { day, count: 2 }).map((c) => c[0].id);
    expect(ids(0)).toEqual(["r1", "c1", "c2"]);
    expect(ids(1)).toEqual(["r1", "c3", "c4"]);
    expect(ids(2)).toEqual(["r1", "c1", "c2"]);
    expect(rotated(bank, undefined)).toBe(bank);
  });
});

// The depth bar (docs/spec.md "Depth first"): understood, right figures, follow-ups, timings.
describe("the depth bar", () => {
  const result = (over: Record<string, unknown>) =>
    ({
      id: "q",
      text: "q",
      needs: "rules",
      status: "graded",
      reason: "",
      score: 100,
      firstWordsMs: 500,
      totalMs: 1500,
      checks: [{ name: "answered", ok: true, reason: "" }],
      ...over,
    }) as CheckRun["results"][number];

  it("works out the three shares and the timings from the results", () => {
    const m = metricsOf([
      result({}),
      result({ checks: [{ name: "answered", ok: false, reason: "" }], score: 40 }),
      result({
        checks: [
          { name: "answered", ok: true, reason: "" },
          { name: "figures", ok: true, reason: "" },
        ],
        followUp: true,
      }),
      result({
        checks: [
          { name: "answered", ok: true, reason: "" },
          { name: "figures", ok: false, reason: "" },
        ],
        followUp: true,
        score: 60,
      }),
      result({ status: "skipped" }),
    ]);
    expect(m.understoodPct).toBe(75);
    expect(m.figuresPct).toBe(50);
    expect(m.followUpsPct).toBe(50);
    expect(m.counts).toEqual({ questions: 4, withFigures: 2, followUps: 2 });
    expect(m.firstWordsMs).toBe(500);
    expect(m.fullAnswerMs).toBe(1500);
  });

  it("is met only with all three at the bar, and the table says so for three nights", () => {
    const good = { understoodPct: 96, figuresPct: 100, followUpsPct: 91 } as never;
    const bad = { understoodPct: 96, figuresPct: 99, followUpsPct: 91 } as never;
    expect(meetsBar(good)).toBe(true);
    expect(meetsBar(bad)).toBe(false);
    expect(meetsBar(undefined)).toBe(false);
    const nights = ["2026-10-19", "2026-10-20", "2026-10-21"].map((date) =>
      night({ date, metrics: good }),
    );
    expect(nightlyTable(nights)).toContain("Met for the last three nights.");
    expect(
      nightlyTable([...nights.slice(0, 2), night({ date: "2026-10-22", metrics: bad })]),
    ).toContain("Not met yet.");
  });
});
