import { describe, expect, it } from "vitest";
import { topicOf, withTopic } from "../context";
import { normalize, parseIntent } from "../intents";

// Follow-ups to an investing answer (found walking the eight sample people): "what about very
// low" after a replay replays that level, "and in 2020" that year, and "why?" after the
// practice trades gives every trade's reason. Anything else reads as it did with no topic.

const AS_OF = "2026-10-22";
const ask = (text: string) => parseIntent(normalize(text), AS_OF);
const after = (first: string, next: string) =>
  withTopic(ask(next), topicOf(ask(first) as never), AS_OF);

describe("follow-ups to an investing answer", () => {
  it("remembers the replay's level and year", () => {
    expect(topicOf(ask("how would a High portfolio have done in 2022"))).toEqual({
      kind: "investments",
      category: "backtest",
      level: 4,
      year: 2022,
    });
  });

  it("replays another level, or another year, of the same question", () => {
    const first = "how would a High portfolio have done in 2022";
    expect(after(first, "what about Very low")).toMatchObject({
      kind: "investments",
      topic: "backtest",
      level: 1,
      year: 2022,
    });
    expect(after(first, "and in 2020?")).toMatchObject({ topic: "backtest", level: 4, year: 2020 });
  });

  it("gives every trade's reason for 'why?' after the practice trades", () => {
    expect(after("what did you buy this week", "why?")).toMatchObject({
      kind: "investments",
      topic: "practice_log",
      explain: true,
    });
  });

  it("leaves other follow-ups as they were", () => {
    // Without a level or a year, a follow-up to a replay isn't a replay.
    expect(after("how would a High portfolio have done in 2022", "what about Netflix")).toEqual(
      withTopic(ask("what about Netflix"), null, AS_OF),
    );
    // "Why?" after any other investing answer reads as it did with no topic.
    expect(after("what are my investment fees", "why?")).toEqual(
      withTopic(ask("why?"), null, AS_OF),
    );
  });

  it("reads 'how much do I have invested' as the holdings, not spending", () => {
    for (const text of [
      "how much do I have invested",
      "how much have I invested",
      "how much money do I have invested",
      "total investments",
    ]) {
      expect(ask(text), text).toMatchObject({ kind: "investments", topic: "holdings" });
    }
  });
});
