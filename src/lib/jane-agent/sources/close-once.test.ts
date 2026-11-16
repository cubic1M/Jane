import { describe, expect, it } from "vitest";
import { closeSource } from "./close";

// Debug 2 (11-16, one month of Wells Fargo checking, the dock at 1280 light): the dock had
// "Confirm 1 charge to close October: $20" (the scan's month-close suggestion) and "Closing
// October 2026: I wasn't sure what this charge was. … Openai on Oct 25: $20.00" (this message),
// the same charge twice. While the suggestion is one of the day's, the message isn't raised.

type Gather = Parameters<typeof closeSource.gather>;

const close = {
  month: "2026-10",
  status: "waiting",
  figures: { spentCents: 0, inCents: 0, netCents: 0 },
  uncertain: [
    {
      id: "t1",
      date: "2026-10-25",
      description: "OPENAI *CHATGPT SUBSCR",
      name: "Openai",
      amountCents: 2_000,
    },
  ],
  closedAt: null,
  correctedAt: null,
};
const gather = (suggestions: { topic: string }[]) =>
  closeSource.gather(
    { close, suggestions } as unknown as Gather[0],
    {
      local: { date: "2026-11-16" },
    } as unknown as Gather[1],
  );

describe("the month close's question", () => {
  it("isn't asked twice when the day's suggestions already ask it", () => {
    expect(gather([{ topic: "month_close" }])).toEqual([]);
  });

  it("is asked when they don't", () => {
    expect(gather([{ topic: "bank_fees" }])).toHaveLength(1);
  });
});
