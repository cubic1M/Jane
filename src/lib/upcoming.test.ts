import { describe, expect, it } from "vitest";
import { GROCERIES, NETFLIX, input, monthly, monthsAgo, tx } from "@/detection/__fixtures__/build";
import { upcomingCharges } from "./upcoming";

const OPTIONS = { days: 31, limit: 5 };

describe("upcomingCharges", () => {
  it("predicts the next charge of each active stream from its usual gap", () => {
    // Monthly on the 15th, last charge today (2026-10-15).
    const [next] = upcomingCharges(input({ transactions: monthly(4, 1549, NETFLIX) }), OPTIONS);

    expect(next).toEqual({ merchant: "Netflix", date: "2026-11-15", amountCents: 1549 });
  });

  it("rolls an overdue charge forward to the next expected date", () => {
    const transactions = [3, 2, 1].map((m) =>
      tx({ ...NETFLIX, date: monthsAgo(m, 20), amountCents: 1549 }),
    );
    const [next] = upcomingCharges(input({ transactions }), OPTIONS);

    expect(next.date >= "2026-10-15").toBe(true);
    expect(next.date <= "2026-11-14").toBe(true);
  });

  it("leaves out non-recurring spending and charges beyond the window", () => {
    const groceries = [
      tx({ ...GROCERIES, amountCents: 5000 }),
      tx({ ...GROCERIES, date: "2026-09-02", amountCents: 9000 }),
    ];

    expect(upcomingCharges(input({ transactions: groceries }), OPTIONS)).toEqual([]);
    expect(
      upcomingCharges(input({ transactions: monthly(4, 1549, NETFLIX) }), { days: 10, limit: 5 }),
    ).toEqual([]);
  });
});
