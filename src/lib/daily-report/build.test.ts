import { describe, expect, it } from "vitest";
import { buildDailyReport, type DailyReportInput } from "./build";
import type { SpendingDay } from "./spending-day";

const spending = (overrides: Partial<SpendingDay> = {}): SpendingDay => ({
  day: "2026-11-22",
  totalCents: 8_420,
  purchases: 6,
  largest: [
    { merchant: "Whole Foods", cents: 4_110 },
    { merchant: "Shell", cents: 3_000 },
  ],
  pending: 0,
  usualCents: 2_200,
  unusual: false,
  ...overrides,
});

const input = (overrides: Partial<DailyReportInput> = {}): DailyReportInput => ({
  today: "2026-11-23",
  spending: spending(),
  reach: "2026-11-23",
  bankUpdated: "2026-11-23",
  suggestions: [],
  suggestionsTotal: 0,
  headsUp: [],
  ahead: [],
  ...overrides,
});

const texts = (report: ReturnType<typeof buildDailyReport>, heading: string) =>
  report.sections.find((s) => s.heading === heading)?.items.map((i) => i.text);

describe("buildDailyReport", () => {
  it("reviews yesterday: the total, the largest few, nothing more on an ordinary day", () => {
    const report = buildDailyReport(input());
    expect(report.sections[0].heading).toBe("Yesterday, Nov 22");
    expect(report.sections[0].items.map((i) => i.text)).toEqual([
      "Your accounts showed 6 purchases totaling $84.20.",
      "Largest: Whole Foods $41.10, Shell $30.00.",
    ]);
    expect(report.subject).toBe("Jane: your daily report, Nov 23");
  });

  it("says so on a quiet day instead of saying nothing", () => {
    const report = buildDailyReport(
      input({ spending: spending({ purchases: 0, totalCents: 0, largest: [] }) }),
    );
    expect(report.busy).toBe(false);
    expect(texts(report, "Yesterday, Nov 22")).toEqual(["Your accounts showed no spending."]);
    expect(texts(report, "Today")).toEqual(["Nothing new from Jane today."]);
  });

  it("says what was unusual, with the usual day beside it, and what is pending", () => {
    const report = buildDailyReport(
      input({ spending: spending({ totalCents: 31_000, unusual: true, pending: 2 }) }),
    );
    expect(report.busy).toBe(true);
    expect(texts(report, "Yesterday, Nov 22")).toEqual(
      expect.arrayContaining([
        "That is well above a usual day: about $22.00, the middle of your last 8 weeks of days with spending.",
        "2 more charges are still pending, and not counted above.",
      ]),
    );
  });

  it("lists new suggestions with their figure and how sure Jane is, each linking to its page", () => {
    const report = buildDailyReport(
      input({
        suggestions: [
          {
            headline: "You pay $12.99 a month for Hulu and $15.49 for Netflix",
            short: "",
            percent: 84,
            worthCents: 1_299,
            path: "/subscriptions",
          },
        ],
        suggestionsTotal: 4,
      }),
    );
    expect(report.sections.find((s) => s.heading === "New from Jane")?.items).toEqual([
      {
        text: "You pay $12.99 a month for Hulu and $15.49 for Netflix (84% sure)",
        path: "/subscriptions",
      },
      { text: "And 3 more on your home page.", path: "/home" },
    ]);
    expect(report.busy).toBe(true);
  });

  it("lists what changed with its confidence, and what is coming up with how soon", () => {
    const report = buildDailyReport(
      input({
        headsUp: [
          { title: "Netflix went up from $15.49 to $17.99.", percent: 88 },
          { title: "Your balance may run low Friday", percent: null },
        ],
        ahead: [
          { label: "Rent", date: "2026-11-24", amountCents: 150_000, daysLeft: 1 },
          {
            label: "Expected pay from Acme",
            date: "2026-11-27",
            amountCents: 240_000,
            daysLeft: 4,
          },
          { label: "Passport renews", date: "2026-11-23", amountCents: null, daysLeft: 0 },
        ],
      }),
    );
    expect(texts(report, "What changed")).toEqual([
      "Netflix went up from $15.49 to $17.99 (88% sure)",
      "Your balance may run low Friday",
    ]);
    expect(texts(report, "Coming up")).toEqual([
      "Rent: $1,500.00, Nov 24 (tomorrow).",
      "Expected pay from Acme: $2,400.00, Nov 27 (in 4 days).",
      "Passport renews: Nov 23 (today).",
    ]);
  });

  it("says where the data ends when the bank hasn't updated, and never reports yesterday as $0", () => {
    const report = buildDailyReport(
      input({
        reach: "2026-11-20",
        bankUpdated: "2026-11-20",
        spending: spending({ purchases: 0, totalCents: 0, largest: [] }),
      }),
    );
    expect(report.sections.some((s) => s.heading.startsWith("Yesterday"))).toBe(false);
    expect(texts(report, "Where your data ends")).toEqual([
      "Your data ends Nov 20, so yesterday is not in it yet.",
      "Your bank last updated Nov 20.",
    ]);
    expect(buildDailyReport(input({ reach: null })).sections.map((s) => s.heading)).toContain(
      "Where your data ends",
    );
  });

  // Every sentence passes src/lib/guardrails.ts: one that fails is left out.
  it("leaves out a sentence that gives advice, promises, tells them to cancel or has an unsupported figure", () => {
    const report = buildDailyReport(
      input({
        suggestions: [
          {
            headline: "Cancel Hulu to save $13 a month",
            short: "",
            percent: 80,
            worthCents: 1_299,
            path: "/subscriptions",
          },
          {
            headline: "Buy shares of Tesla stock",
            short: "",
            percent: 70,
            worthCents: 0,
            path: "/investments",
          },
          {
            headline: "You are guaranteed to save $500 a year",
            short: "",
            percent: 90,
            worthCents: 50_000,
            path: "/bills",
          },
          {
            headline: "Your phone plan costs $60.00 a month",
            short: "",
            percent: 75,
            worthCents: 6_000,
            path: "/bills",
          },
        ],
        suggestionsTotal: 4,
        headsUp: [{ title: "I cancelled your Hulu for you", percent: 99 }],
      }),
    );
    const shown = texts(report, "New from Jane") ?? [];
    expect(shown.join(" ")).not.toMatch(/tesla|guaranteed|cancel/i);
    expect(shown).toContain("Your phone plan costs $60.00 a month (75% sure)");
    expect(texts(report, "What changed")).toBeUndefined();
  });

  it("never puts an amount or a name in the subject, and lists at most three suggestions", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      headline: `Idea number ${i}`,
      short: "",
      percent: 70,
      worthCents: 0,
      path: "/home",
    }));
    const report = buildDailyReport(input({ suggestions: many, suggestionsTotal: 5 }));
    expect(report.subject).not.toMatch(/\$|Whole Foods/);
    expect(report.sections.find((s) => s.heading === "New from Jane")?.items).toHaveLength(4);
  });

  it("says what the bank posted since the last report with earlier dates, right after yesterday", () => {
    const report = buildDailyReport(
      input({
        postedSince: {
          count: 2,
          totalCents: 4_700,
          largest: [
            { merchant: "Sunrise Diner", cents: 3_500 },
            { merchant: "Cafe Rio", cents: 1_200 },
          ],
        },
      }),
    );
    expect(report.sections.map((s) => s.heading)).toEqual([
      "Yesterday, Nov 22",
      "Posted since your last report",
    ]);
    expect(texts(report, "Posted since your last report")).toEqual([
      "Your bank posted 2 charges totaling $47.00 with earlier dates (Sunrise Diner $35.00, Cafe Rio $12.00).",
    ]);
    // It is news, so the day isn't called quiet.
    expect(report.busy).toBe(true);
  });

  it("says nothing of posted lines when none arrived, and says refunds as refunds", () => {
    expect(
      buildDailyReport(input({ postedSince: { count: 0, totalCents: 0, largest: [] } })).busy,
    ).toBe(false);
    const refunds = buildDailyReport(
      input({ postedSince: { count: 0, totalCents: -1_500, largest: [] } }),
    );
    expect(texts(refunds, "Posted since your last report")).toEqual([
      "Your bank posted $15.00 back in refunds with earlier dates.",
    ]);
  });
});

describe("what changed: which changes the report says it listed", () => {
  const alert = (i: number) => ({ title: `Alert number ${i}`, percent: 80 });
  const change = (i: number, title = `Bill ${i} went up from $10.00 to $12.00.`) => ({
    title,
    percent: 70,
    changeKey: `bill:${i}`,
  });
  const keysOf = (report: ReturnType<typeof buildDailyReport>) =>
    report.sections.flatMap((s) => s.items).flatMap((i) => (i.key ? [i.key] : []));

  it("carries the key of only the changes that make the list, never one cut by the limit", () => {
    // Five alerts fill the list: the changes behind them are not in the report, so not listed as such.
    const full = buildDailyReport(
      input({ headsUp: [...[1, 2, 3, 4, 5].map(alert), change(1), change(2)] }),
    );
    expect(texts(full, "What changed")).toHaveLength(5);
    expect(keysOf(full)).toEqual([]);

    // Three alerts leave room for two: the third change is cut, and is not remembered.
    const room = buildDailyReport(
      input({ headsUp: [...[1, 2, 3].map(alert), change(1), change(2), change(3)] }),
    );
    expect(texts(room, "What changed")).toHaveLength(5);
    expect(keysOf(room)).toEqual(["bill:1", "bill:2"]);
  });

  it("doesn't remember a change the guardrails left out, and it doesn't use up a place", () => {
    const report = buildDailyReport(
      input({
        headsUp: [
          ...[1, 2, 3, 4].map(alert),
          change(1, "Cancel Netflix because it went up."),
          change(2),
        ],
      }),
    );
    expect(texts(report, "What changed")).toHaveLength(5);
    expect(keysOf(report)).toEqual(["bill:2"]);
  });

  it("says how many decisions wait for an answer in the chat, with a link, and nothing when none", () => {
    expect(texts(buildDailyReport(input({ waiting: 3 })), "Waiting for you")).toEqual([
      "3 things are waiting for your answer in your chat.",
    ]);
    const one = buildDailyReport(input({ waiting: 1 }));
    expect(texts(one, "Waiting for you")).toEqual([
      "1 thing is waiting for your answer in your chat.",
    ]);
    expect(one.sections.find((s) => s.heading === "Waiting for you")?.items[0].path).toBe("/chat");
    // It is news, so the day isn't called quiet.
    expect(one.busy).toBe(true);
    expect(buildDailyReport(input({ waiting: 0 })).sections.map((s) => s.heading)).not.toContain(
      "Waiting for you",
    );
  });
});
