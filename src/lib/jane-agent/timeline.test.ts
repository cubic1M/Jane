import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/lib/timeline";
import { parseIntent } from "./intents";
import { timelineReply } from "./replies-timeline";

// Spec step 187: "why did you do that?" and "show me everything you did".

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: "act:1",
  at: new Date("2026-10-18T15:00:00Z"),
  sector: "bills",
  sectorLabel: "Subscriptions and bills",
  by: "jane",
  what: "Asked Netflix for your old price",
  why: "Subscriptions and bills is on your autopilot, and this was within the limits you set.",
  cents: 3_000,
  undoHref: null,
  ...over,
});

describe("the timeline in the chat", () => {
  it.each([
    ["why did you do that", true],
    ["why did you move that money", true],
    ["show me everything you did", false],
    ["activity log", false],
    ["what have you done for me so far", false],
  ])("reads %j", (text, why) => {
    expect(parseIntent(text, "2026-10-19")).toEqual({ kind: "timeline", why });
  });

  it("answers why from the latest entry, with undo while it works", () => {
    const reply = timelineReply(
      [entry({ undoHref: "/transfers" }), entry({ id: "act:0" })],
      true,
      "2026-10-19",
    );
    expect(reply.body).toBe(
      "yesterday: Asked Netflix for your old price ($30.00). Subscriptions and bills is on your autopilot, and this was within the limits you set.",
    );
    expect(reply.actions.map((a) => a.label)).toEqual(["Undo it", "Everything Jane did"]);
  });

  it("lists the latest few, and says so when there are none", () => {
    const many = Array.from({ length: 7 }, (_, i) => entry({ id: `act:${i}` }));
    const lines = timelineReply(many, false, "2026-10-19").body.split("\n");
    expect(lines[0]).toBe("Here are my latest 5 of 7, each with why on the page.");
    expect(lines).toHaveLength(6);
    expect(timelineReply([], false, "2026-10-19").body).toMatch(/haven't done anything/);
  });
});
