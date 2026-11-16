import { describe, expect, it } from "vitest";
import { costReply } from "./recurring-replies";
import type { Recurring } from "./recurring";
import type { Snapshot } from "./snapshot";

// Debugger 11-16 (Plaid sandbox, phone): $900 by Zelle to the same person on the 1st of each month,
// unanswered "Is this your rent?". "How much do I pay in rent?" read "You spent $0.00 on Rent and
// utilities in November 2026 so far": the payments are transfers until the person says.

const recurring = { charges: [], nextIncome: null } as unknown as Recurring;
const rentQuestion = {
  merchantKey: "zelle to sam okafor",
  name: "Sam Okafor",
  amountCents: 90_000,
  months: 3,
  transactionIds: ["a", "b", "c"],
};
const snapshot = (rent: typeof rentQuestion | null) =>
  ({ findings: [], concierge: false, rentQuestion: rent }) as unknown as Snapshot;

describe("asking about rent while Jane's rent question waits", () => {
  it("asks it, with the question's own buttons", () => {
    const reply = costReply(
      { target: "rent", year: false },
      recurring,
      snapshot(rentQuestion),
      "2026-11-16",
    );
    expect(reply?.body).toContain("You send Sam Okafor $900.00 near the start of each month");
    expect(reply?.body).toContain("Is this your rent?");
    expect(reply?.body).not.toContain("$0.00");
    expect(reply?.actions.map((a) => a.id)).toEqual(["rent.yes", "rent.no"]);
    expect(reply?.refs.rentKey).toBe("zelle to sam okafor");
  });

  it("with no question waiting, it's still what was spent", () => {
    expect(
      costReply({ target: "rent", year: false }, recurring, snapshot(null), "2026-11-16"),
    ).toBeNull();
  });
});
