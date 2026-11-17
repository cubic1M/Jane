import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { suggestionsSource } from "./suggestions";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox default user): a first scan's early run posted
// its picks before last month's close was worked out, so "Confirm 1 charge to close October: $20"
// went to the dock; the close's own message (with "Looks right") then waited behind the day's
// limit. The suggestion's Yes opens October's transactions, where nothing confirms a charge.

const monthClose = {
  id: "month_close",
  chosenOn: "2026-11-17",
  key: "close:month_close",
  topic: "month_close",
  title: "t",
  headline: "Confirm 1 charge to close October: $20",
  short: "OpenAI $20.00: I'm not sure what it was.",
  why: "w",
  worthCents: 2_000,
  worthKind: "risk",
  confidencePercent: 65,
  confidenceReason: "1 unsure charge",
  actionLabel: "Confirm the charges",
  actionHref: "/transactions?from=2026-10-01&to=2026-10-31",
  more: [],
  advice: false,
};

describe("the month-close suggestion before the close is worked out", () => {
  it("isn't a card in the dock", () => {
    const cards = suggestionsSource.gather(
      { close: null, suggestions: [monthClose] } as unknown as Snapshot,
      { local: { date: "2026-11-17" } } as never,
    );
    expect(cards).toEqual([]);
  });
});
