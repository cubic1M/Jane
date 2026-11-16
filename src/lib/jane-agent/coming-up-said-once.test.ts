import { describe, expect, it } from "vitest";
import { comingUpReply } from "./replies";

// Debug 2 (11-16, an old Bank of America statement, the side chat at 1280 light): "what bills do I
// have coming up?" listed four bills ("- Nov 20 (in 4 days): Monthly Maintenance Fee, $12.00" …)
// and then drew the same four as the "Coming up" timeline under them. When the timeline holds
// them all, the words say how many and how much; without one, the list stays.

const rows = [
  { date: "2026-11-20", daysLeft: 4, label: "Monthly Maintenance Fee", amountCents: 1_200 },
  { date: "2026-12-03", daysLeft: 17, label: "Essex Property", amountCents: 98_000 },
] as Parameters<typeof comingUpReply>[1];
const intent = { kind: "coming_up", days: null } as Parameters<typeof comingUpReply>[0];

describe("what's coming up, in the chat", () => {
  it("doesn't list the rows the timeline below already draws", () => {
    expect(comingUpReply(intent, rows, { drawn: true }).body).toBe(
      "2 things are coming up, $992.00 in all.",
    );
  });

  it("lists them when nothing is drawn", () => {
    expect(comingUpReply(intent, rows).body).toContain(
      "- Nov 20 (in 4 days): Monthly Maintenance Fee, $12.00",
    );
  });
});
