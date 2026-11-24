import { describe, expect, it } from "vitest";
import { MESSAGE_SOURCES } from "./index";
import { suggestionsSource } from "./suggestions";

// Founder 11-24: Jane doesn't bring last month's close up unasked. It was a card in the dock while
// the close waited on a charge ("Closing October 2026: I wasn't sure what this charge was"), and
// the scan's month-close suggestion beside it; neither is posted now. The close's page is /close
// (reached from Spending & bills); asked about in the chat, it answers there with "Looks right".

type Snapshot = Parameters<typeof suggestionsSource.gather>[0];
type Context = Parameters<typeof suggestionsSource.gather>[1];

const suggestion = (topic: string) => ({
  id: `s-${topic}`,
  chosenOn: "2026-11-16",
  key: `close:${topic}`,
  topic,
  title: "Confirm 1 charge to close October",
  headline: "Confirm 1 charge to close October: $20",
  short: "OpenAI $20.00 isn't one Jane is sure of.",
  why: "One charge in October is in a catch-all category.",
  worthCents: 2_000,
  worthKind: "risk",
  confidencePercent: 70,
  confidenceReason: "one charge",
  actionLabel: "Confirm it",
  actionHref: "/transactions",
  more: [],
  advice: false,
});
const gather = (topics: string[]) =>
  suggestionsSource.gather(
    { suggestions: topics.map(suggestion) } as unknown as Snapshot,
    { local: { date: "2026-11-16" } } as unknown as Context,
  );

describe("the month close's question", () => {
  it("has no source of its own", () => {
    expect(MESSAGE_SOURCES.map((s) => s.key)).not.toContain("close");
  });

  it("is never asked, even when the day's suggestions include the close", () => {
    // A control, so this fails if the filter goes: the same suggestion on another topic is a card.
    expect(gather(["bank_fees"])).toHaveLength(1);
    expect(gather(["month_close"])).toEqual([]);
    expect(gather(["month_close", "bank_fees"]).map((m) => m.refs.suggestion)).toEqual([
      "close:bank_fees",
    ]);
  });
});
