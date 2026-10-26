import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/events/view", () => ({ loadEventsView: vi.fn() }));

import type { PrismaClient } from "@/generated/prisma/client";
import { loadEventsView, type EventsView } from "@/lib/events/view";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";
import { EVENTS_NOT_IN_ADVICE } from "./events-tools";
import { toolsFor } from "./tool-select";

// The events overlay in Jane's chat: a read-only tool over what the Events box shows; a real
// account gets a note and nothing else.

const NOW = new Date("2026-10-20T15:00:00Z");
const client = {} as PrismaClient;

const VIEW: EventsView = {
  on: true,
  hasAccount: true,
  level: 3,
  label: "Demo advice: sample data, not financial advice",
  now: [
    {
      key: "gdelt:chip_boom:2026-10-19",
      date: "2026-10-19",
      label: "A chip boom",
      theme: "Chip makers",
      title: "A chip boom: news coverage 3.1 times its usual level",
      source: "gdelt",
      url: null,
      confidence: 57,
      plan: "Did: +SMH, 2% of the account for up to 20 trading days",
      acting: true,
    },
  ],
  open: [{ ticker: "SMH", side: "buy", tilt: 0.02, enteredOn: "2026-10-20", reason: "…" }],
  recent: [],
  record: [],
  backtest: {
    from: "2017-03-01",
    to: "2026-10-21",
    level: 3,
    alone: { yearly: 0.084, maxDrawdown: -0.219, sharpe: 0.57 },
    withEvents: { yearly: 0.086, maxDrawdown: -0.224, sharpe: 0.58 },
  },
};

describe("the events_overlay tool", () => {
  beforeEach(() => vi.mocked(loadEventsView).mockResolvedValue(VIEW));

  it("is one of Claude's tools and goes with questions about the overlay", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toContain("events_overlay");
    const names = (q: string) =>
      toolsFor(CHAT_TOOLS, q, null, null, "2026-10-20").map((t) => t.name);
    expect(names("what is the events overlay doing?")).toContain("events_overlay");
    expect(names("how much did I spend on groceries")).not.toContain("events_overlay");
  });

  it("returns what the box shows, with how sure and the label", async () => {
    const out = await runChatTool("u1", "events_overlay", {}, { client, now: NOW });
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({ on: true, label: VIEW.label });
    expect(body.happeningNow[0]).toMatchObject({ event: "A chip boom", confidencePercent: 57 });
    expect(body.openSlices[0].ticker).toBe("SMH");
    expect(out.cents).toEqual([]);
  });

  it("gives a real account a note and nothing else", async () => {
    vi.mocked(loadEventsView).mockResolvedValue(null);
    const out = await runChatTool("u2", "events_overlay", {}, { client, now: NOW });
    expect(JSON.parse(out.content)).toEqual({ note: EVENTS_NOT_IN_ADVICE });
  });
});
