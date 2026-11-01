import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { rentInQuestionSource } from "./rent-in-question";

const context = {
  now: new Date("2026-11-01T12:00:00Z"),
  local: {} as never,
  trigger: "open" as const,
};

// Debugger 11-01: a tenant's rent by Zelle was a transfer in, so income and taxes left it out.
describe("the rent-collected question in the chat", () => {
  it("asks once per payer, with a yes and a no", () => {
    const snapshot = {
      rentInQuestion: {
        merchantKey: "from jordan tenant",
        name: "Jordan Tenant",
        amountCents: 195_000,
        months: 3,
        transactionIds: ["a", "b", "c"],
      },
    } as unknown as Snapshot;
    const [message] = rentInQuestionSource.gather(snapshot, context);
    expect(message.body).toBe(
      "Jordan Tenant sends you $1,950.00 near the start of each month (3 months so far). Is it rent you collect? If it is, I'll count it as rental income, in your income and your taxes. If it's someone's share of your own rent, say no.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["rent_in.yes", "rent_in.no"]);
    expect(message.refs).toEqual({ rentKey: "from jordan tenant" });
    expect(message.dedupeKey).toBe("rent-in:from jordan tenant");
  });

  it("says nothing without a payer to ask about", () => {
    expect(rentInQuestionSource.gather({} as unknown as Snapshot, context)).toEqual([]);
  });
});
