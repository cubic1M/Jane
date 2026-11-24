import { describe, expect, it } from "vitest";
import { MESSAGE_SOURCES } from "./index";

// Founder 11-24: Jane doesn't bring last month's close up unasked. It was a card in the dock while
// the close waited on a charge ("Closing October 2026: I wasn't sure what this charge was"), and
// the scan's month-close suggestion beside it; neither is posted now. The close's page is /close
// (reached from Spending & bills); asked about in the chat, it answers there with "Looks right".

type Snapshot = Parameters<(typeof MESSAGE_SOURCES)[number]["gather"]>[0];
type Context = Parameters<(typeof MESSAGE_SOURCES)[number]["gather"]>[1];

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
  MESSAGE_SOURCES.flatMap((source) => {
    try {
      return source.gather(
        { close, suggestions } as unknown as Snapshot,
        {
          local: { date: "2026-11-16" },
        } as unknown as Context,
      );
    } catch {
      // A source that needs more of the snapshot than this test gives it has nothing to do with
      // the close.
      return [];
    }
  });

describe("the month close's question", () => {
  it("has no source of its own", () => {
    expect(MESSAGE_SOURCES.map((s) => s.key)).not.toContain("close");
  });

  it("is never asked, even when the day's suggestions include the close", () => {
    const posted = gather([{ topic: "month_close" }]);
    expect(posted.filter((m) => /^Closing October 2026/.test(m.body))).toEqual([]);
    expect(posted.filter((m) => m.refs.closeMonth !== undefined)).toEqual([]);
  });
});
