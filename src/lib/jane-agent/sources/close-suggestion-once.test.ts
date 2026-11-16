import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { suggestionsSource } from "./suggestions";

// Debug 2 re-walk (11-16, one month of Wells Fargo checking, 1280 light): with #1911 the dock kept
// "Confirm 1 charge to close October: $20" and dropped the close message. That suggestion's Yes
// opens October's transactions in the beta, where nothing confirms a charge, so the month could no
// longer be closed from the dock. While the close waits, its message (with "Looks right") is the
// card, and the month-close suggestion isn't raised.

const suggestion = (topic: string) => ({
  id: topic,
  chosenOn: "2026-11-16",
  key: `close:${topic}`,
  topic,
  title: "t",
  headline: "Confirm 1 charge to close October: $20",
  short: "Openai $20.00: I'm not sure what it was.",
  why: "w",
  worthCents: 2_000,
  worthKind: "risk",
  confidencePercent: 50,
  confidenceReason: "1 unsure charge in 1 month of data",
  actionLabel: "Confirm the charges",
  actionHref: "/transactions?from=2026-10-01&to=2026-10-31",
  more: [],
  advice: false,
});
const topics = (close: { status: string } | null) =>
  suggestionsSource
    .gather(
      {
        close,
        suggestions: [suggestion("month_close"), suggestion("bank_fees")],
      } as unknown as Snapshot,
      { local: { date: "2026-11-16" } } as never,
    )
    .map((c) => (c.refs as { suggestion: string }).suggestion);

describe("the month-close suggestion card", () => {
  it("isn't raised while the close's own message asks", () => {
    expect(topics({ status: "waiting" })).toEqual(["close:bank_fees"]);
  });

  it("is raised otherwise", () => {
    expect(topics(null)).toEqual(["close:month_close", "close:bank_fees"]);
  });
});
