import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { rentQuestionSource } from "./rent-question";

const context = {
  now: new Date("2026-10-28T12:00:00Z"),
  local: {} as never,
  trigger: "open" as const,
};

describe("the rent question in the chat", () => {
  it("asks once per payee, with a yes and a no", () => {
    const snapshot = {
      rentQuestion: {
        merchantKey: "lucia gomez",
        name: "Lucia Gomez",
        amountCents: 176_213,
        months: 3,
        transactionIds: ["a", "b", "c"],
      },
    } as unknown as Snapshot;
    const [message] = rentQuestionSource.gather(snapshot, context);
    expect(message.body).toBe(
      "You send Lucia Gomez $1,762.13 near the start of each month (3 months so far). Is this your rent? If it is, I'll count it as rent in your spending, your bills and your cushion.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["rent.yes", "rent.no"]);
    expect(message.refs).toEqual({ rentKey: "lucia gomez" });
    expect(message.dedupeKey).toBe("lucia gomez");
  });

  it("says nothing when there's no one to ask about", () => {
    expect(
      rentQuestionSource.gather({ rentQuestion: null } as unknown as Snapshot, context),
    ).toEqual([]);
  });
});
