import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { Ranked } from "@/planning/priorities";
import { topicOf, withTopic } from "./context";
import { parseIntent } from "./intents";
import { prioritiesReply } from "./replies-priorities";

// "Why is that first?" and "tell me more" after "what should I do first" are about the list
// just given, never "which one do you mean" about an unrelated merchant.

const ASOF = "2026-10-19";
const item = (title: string, why: string): Ranked =>
  ({
    key: title,
    kind: "finding",
    title,
    valueCents: 129_600,
    minutes: 5,
    confidence: "high",
    href: "/debt",
    score: 10,
    urgencyScore: 0.5,
    why,
  }) as Ranked;

describe("why is that first", () => {
  it("keeps the list as the topic", () => {
    expect(topicOf(parseIntent("what should i do first", ASOF))).toEqual({ kind: "priorities" });
  });

  it.each(["why is that first", "tell me more", "why?"])("reads %j against the list", (text) => {
    expect(withTopic(parseIntent(text, ASOF), { kind: "priorities" }, ASOF)).toEqual({
      kind: "priorities",
      explain: true,
    });
  });

  it("explains the first item and says how the list is ranked", () => {
    const reply = prioritiesReply(
      [
        item("Pay down the card", "It costs you $1,296 a year in interest."),
        item("Cancel Hulu", "x"),
      ],
      true,
    );
    expect(reply.body).toContain("Pay down the card is first because it costs you $1,296 a year");
    expect(reply.body).toContain("money at stake");
    expect(reply.body).toContain("After it: Cancel Hulu.");
    expect(reply.body).not.toMatch(/Which one/);
  });
});
