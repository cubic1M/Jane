import { describe, expect, it } from "vitest";
import { plan, type History } from "./brain";
import type { Attention } from "./attention";
import type { Snapshot } from "./snapshot";
import type { MessageSource } from "./sources";
import { attentionSource } from "./sources/attention";

// Spec step 147 in Jane's brain: a stopped kind isn't posted (and Jane says so once), what
// isn't urgent waits for the person's usual hour, and urgent things never wait.

const NOW = new Date("2026-10-19T15:00:00Z"); // 8am in Los Angeles
const NONE: History = { recent: [], seenKeys: [] };
const source = (key: string): MessageSource => ({
  key,
  gather: () => [
    {
      kind: "decision",
      body: `${key} says hi.`,
      refs: {},
      actions: [{ id: "finding.yes", label: "Yes", kind: "primary" }],
      dedupeKey: "one",
      priority: 10,
    },
  ],
});
const SOURCES = [source("budgets"), source("changes"), source("heads_ups"), attentionSource];

const snapshot = (attention: Snapshot["attention"]) =>
  ({ timezone: "America/Los_Angeles", asOf: "2026-10-19", attention }) as unknown as Snapshot;
const quiet: Attention = {
  usualHour: null,
  channel: null,
  stopped: [],
  lastPostedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
};
const posted = (s: Snapshot, trigger: "sync" | "open" = "sync") =>
  plan(s, NONE, NOW, { trigger, sources: SOURCES }).map((m) => m.source);

describe("asking less in the brain", () => {
  it("says everything when Jane hasn't learned anything yet", () => {
    expect(posted(snapshot(quiet))).toEqual(["budgets", "changes", "heads_ups"]);
  });

  it("stops a kind the person never says yes to, and says so once", () => {
    const stopped = [
      { source: "budgets", label: "budget check-ins", asked: 4, lastOn: "2026-10-12" },
    ];
    const out = plan(snapshot({ ...quiet, stopped }), NONE, NOW, {
      trigger: "sync",
      sources: SOURCES,
    });
    expect(out.map((m) => m.source)).toEqual(["attention", "changes", "heads_ups"]);
    expect(out[0].body).toMatch(
      /^I'll stop bringing up budget check-ins: you haven't said yes to the last 4/,
    );
    expect(out[0].refs).toEqual({ attentionSource: "budgets" });
  });

  it("holds what isn't urgent for the usual hour, but not when the person opened the chat", () => {
    const evenings = snapshot({ ...quiet, usualHour: 19 });
    expect(posted(evenings)).toEqual(["heads_ups"]);
    expect(posted(evenings, "open")).toEqual(["budgets", "changes", "heads_ups"]);
  });
});
