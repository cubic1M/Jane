import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import { saveMoreReply } from "./replies-savemore";
import type { GoalView } from "@/lib/goals";

describe("what-if questions in the chat", () => {
  it("reads a thought experiment, with how long it lasts", () => {
    expect(parseIntent("what if I lose my job for 4 months", "2026-10-20")).toEqual({
      kind: "what_if",
      scenario: "job_loss",
      months: 4,
    });
    expect(parseIntent("what happens if we have a baby", "2026-10-20")).toMatchObject({
      kind: "what_if",
      scenario: "baby",
    });
    expect(parseIntent("I lost my job", "2026-10-20").kind).not.toBe("what_if");
  });

  it("reads saving more a month, and 'how did I do this month'", () => {
    expect(parseIntent("what if I save $200 more a month", "2026-10-20")).toEqual({
      kind: "save_more",
      monthlyCents: 20_000,
    });
    expect(parseIntent("how did I do this month", "2026-10-20")).toEqual({
      kind: "monthly_report",
    });
  });
});

describe("saving more a month", () => {
  const goal = (left: number): GoalView =>
    ({
      id: "g",
      name: "Emergency fund",
      progress: { status: "on_the_way", leftCents: left },
    }) as unknown as GoalView;

  it("gives the year, and how soon it covers the biggest goal", () => {
    const reply = saveMoreReply(20_000, [goal(100_000)]);
    expect(reply.body).toBe(
      "Saving $200.00 more a month is $2,400.00 a year.\nPut towards your Emergency fund goal, which still needs $1,000.00, that alone would cover it in about 5 months.",
    );
    expect(reply.actions[0]).toMatchObject({ href: "/goals" });
  });

  it("offers to start a goal when there is none", () => {
    expect(saveMoreReply(10_000, []).actions[0]).toMatchObject({ id: "goal.start" });
  });
});
