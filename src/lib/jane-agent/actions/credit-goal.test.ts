import { describe, expect, it } from "vitest";
import { ChatActionError } from "./handler";
import { creditGoalDone } from "./credit-goal";

// CodeRabbit part 2: a card saved before the month was kept on it must not tick off this month.
describe("Done on a credit plan card", () => {
  it("is refused when the card does not say which month it showed", async () => {
    const run = creditGoalDone.run({
      userId: "u1",
      message: { refs: { creditGoalId: "g1" } },
      action: { label: "Done" },
      client: {},
      now: new Date("2026-11-25T12:00:00Z"),
    } as unknown as Parameters<typeof creditGoalDone.run>[0]);
    await expect(run).rejects.toBeInstanceOf(ChatActionError);
    await expect(run).rejects.toMatchObject({ code: "expired" });
  });
});
