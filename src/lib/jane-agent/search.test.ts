import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "./intents";
import { parseSearch } from "./search";
import { weekSource } from "./sources/week";
import type { Snapshot } from "./snapshot";
import { localTime } from "./quiet-hours";

// Spec step 96: what a search looks for, typed search, and the week's summary.

const TODAY = "2026-10-19";

describe("parseSearch", () => {
  it("reads words, an amount and a day", () => {
    expect(parseSearch("Netflix $17.99", TODAY)).toEqual({
      words: ["netflix"],
      amountCents: 1799,
      date: null,
    });
    expect(parseSearch("hulu 11.99", TODAY)).toMatchObject({ amountCents: 1199 });
    expect(parseSearch("$145", TODAY)).toMatchObject({ amountCents: 14500, words: [] });
    expect(parseSearch("refund on Oct 2", TODAY)).toEqual({
      words: ["refund", "on"],
      amountCents: null,
      date: "2026-10-02",
    });
    // A day later than today is last year's.
    expect(parseSearch("Dec 24", TODAY).date).toBe("2025-12-24");
    expect(parseSearch("2026-09-14", TODAY).date).toBe("2026-09-14");
    expect(parseSearch("a", TODAY)).toEqual({ words: [], amountCents: null, date: null });
  });

  it("is what the rules read typed searches as", () => {
    expect(parseIntent("search for Netflix", TODAY)).toEqual({ kind: "search", query: "netflix" });
    expect(parseIntent("find hulu in the chat", TODAY)).toEqual({ kind: "search", query: "hulu" });
    expect(parseIntent("where did you say peacock", TODAY)).toEqual({
      kind: "search",
      query: "peacock",
    });
  });
});

describe("the week's summary", () => {
  const snapshot = (lastWeek: Snapshot["lastWeek"]) =>
    ({ weekStart: "2026-10-19", lastWeek }) as unknown as Snapshot;
  const monday = new Date("2026-10-19T15:00:00Z");
  const context = {
    now: monday,
    local: localTime(monday, "America/Los_Angeles"),
    trigger: "cron" as const,
  };

  it("says what last week covered, at the top of the week", () => {
    const [message] = weekSource.gather(
      snapshot({ start: "2026-10-12", asked: 5, yes: 2, no: 1, done: 1 }),
      context,
    );
    expect(message).toMatchObject({
      kind: "brief",
      dedupeKey: "2026-10-19",
      body: "The week of Oct 12, we covered 5 questions you asked, 3 decisions (2 yes, 1 no), 1 thing I finished. You can search anything we said, or pin what you want to keep at the top.",
    });
    expect(message.priority).toBeGreaterThan(1_000);
  });

  it("says nothing after a quiet week, or before the morning", () => {
    expect(
      weekSource.gather(
        snapshot({ start: "2026-10-12", asked: 0, yes: 0, no: 0, done: 0 }),
        context,
      ),
    ).toEqual([]);
    expect(weekSource.gather(snapshot(undefined), context)).toEqual([]);
    const early = new Date("2026-10-19T12:00:00Z");
    expect(
      weekSource.gather(snapshot({ start: "2026-10-12", asked: 1, yes: 0, no: 0, done: 0 }), {
        now: early,
        local: localTime(early, "America/Los_Angeles"),
        trigger: "cron",
      }),
    ).toEqual([]);
  });
});
