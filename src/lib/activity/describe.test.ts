import { describe, expect, it } from "vitest";
import {
  describeActivity,
  describeFunnel,
  duration,
  groupVisits,
  pageName,
  type ActivityItem,
} from "./describe";

const T = Date.UTC(2026, 9, 26, 17, 42);
const item = (over: Partial<ActivityItem> & { min?: number }): ActivityItem => ({
  at: new Date(T + (over.min ?? 0) * 60_000),
  visitId: "visit1",
  kind: "page_view",
  path: "/subscriptions",
  role: null,
  label: null,
  data: {},
  ...over,
});
const text = (over: Partial<ActivityItem>) => describeActivity(item(over))?.text;

describe("the founder view's words", () => {
  it("names pages the way the menu does", () => {
    expect(pageName("/")).toBe("the landing page");
    expect(pageName("/money")).toBe("Spending & bills");
    expect(pageName("/subscriptions")).toBe("Subscriptions");
    expect(pageName("/report/:id")).toBe("Report");
    expect(pageName("/life-events")).toBe("Life events");
  });

  it("says durations simply", () => {
    expect(duration(4_200)).toBe("4s");
    expect(duration(80_000)).toBe("1m 20s");
    expect(duration(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });

  it("describes each kind of event", () => {
    expect(text({})).toBe("opened Subscriptions");
    expect(text({ kind: "click", role: "button", label: "Cancel Netflix" })).toBe(
      "clicked 'Cancel Netflix'",
    );
    expect(text({ kind: "click", role: "link", label: "Bills" })).toBe("tapped the link 'Bills'");
    expect(text({ kind: "page_time", data: { ms: 80_000 } })).toBe("spent 1m 20s on Subscriptions");
    expect(text({ kind: "submit", label: "goal", data: { fields: ["a", "b"], ms: 12_000 } })).toBe(
      "sent the 'goal' form (2 fields filled, after 12s)",
    );
    expect(text({ kind: "blur", label: "message", data: { typed: true, length: 24 } })).toBe(
      "typed in 'message' (24 characters)",
    );
    expect(text({ kind: "blur", label: "amount", data: { typed: true, private: true } })).toBe(
      "typed in 'amount'",
    );
    expect(text({ kind: "blur", label: "note", data: { typed: false } })).toBe(
      "clicked into 'note' and left it empty",
    );
    expect(
      describeActivity(item({ kind: "rage_click", label: "Save", data: { count: 3 } })),
    ).toEqual({
      text: "clicked 'Save' 3 times fast (stuck?)",
      warn: true,
    });
    expect(describeActivity(item({ kind: "error", label: "Load failed" }))).toEqual({
      text: "saw an error: 'Load failed'",
      warn: true,
    });
  });

  it("leaves out focus alone and a blink of a page", () => {
    expect(text({ kind: "focus", label: "message" })).toBeUndefined();
    expect(text({ kind: "page_time", data: { ms: 300 } })).toBeUndefined();
  });

  it("says card choices in the person's words, without amounts", () => {
    expect(
      describeFunnel({
        at: new Date(T),
        name: "diy_started",
        properties: { finding_type: "subscription_review", annual_savings_cents: 19_188 },
      }),
    ).toEqual({
      text: "chose 'Do it myself' on a card (finding type: subscription review)",
      warn: false,
    });
    expect(
      describeFunnel({ at: new Date(T), name: "import_failed", properties: { format: "csv" } }),
    ).toEqual({
      text: "tried to upload a statement, and it failed (format: csv)",
      warn: true,
    });
    // Page views are already in the activity log.
    expect(describeFunnel({ at: new Date(T), name: "taxes_viewed", properties: {} })).toBeNull();
  });
});

describe("groupVisits", () => {
  it("groups by visit, splits after a long gap, newest visit first, and slots card choices in", () => {
    const visits = groupVisits(
      [
        item({ min: 0 }),
        item({ min: 1, kind: "click", role: "button", label: "Cancel Netflix" }),
        item({ min: 90, path: "/home" }),
        item({ min: 91, visitId: "visit2", path: "/bills" }),
      ],
      [{ at: new Date(T + 2 * 60_000), name: "diy_started", properties: {} }],
    );
    expect(visits.map((v) => v.lines.map((l) => l.text))).toEqual([
      ["opened Bills"],
      ["opened Home"],
      ["opened Subscriptions", "clicked 'Cancel Netflix'", "chose 'Do it myself' on a card"],
    ]);
    expect(visits[2].start).toEqual(new Date(T));
    expect(visits[2].end).toEqual(new Date(T + 2 * 60_000));
  });
});
