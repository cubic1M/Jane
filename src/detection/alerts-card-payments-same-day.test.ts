import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, SAVINGS, input, monthsAgo, tx } from "./__fixtures__/build";
import { billReminderAlerts } from "./alerts";

// CodeRabbit 1c detn-01 #9: two card payments due the same day shared one reminder key, so the
// second reminder was thrown away when the alerts were saved.
const payment = (description: string, accountId: string, cents: number) =>
  [4, 3, 2, 1].map((m) =>
    tx({
      accountId,
      date: monthsAgo(m, 16),
      amountCents: cents,
      description,
      merchantName: null,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    }),
  );

describe("bill reminders for card payments due the same day", () => {
  const accounts = [
    { ...CHECKING, currentBalanceCents: 900_000 },
    { ...SAVINGS, currentBalanceCents: 900_000 },
  ];
  const twoCards = input({
    accounts,
    transactions: [
      ...payment("CHASE CREDIT CRD AUTOPAY THANK YOU", CHECKING.id, 6_000),
      ...payment("CITI CARD ONLINE PAYMENT", SAVINGS.id, 9_000),
    ],
  });
  const oneCard = input({
    accounts,
    transactions: payment("CHASE CREDIT CRD AUTOPAY THANK YOU", CHECKING.id, 6_000),
  });

  it("gives each its own key", () => {
    const keys = billReminderAlerts(twoCards).map((a) => a.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("keeps the old shared key on one of them, and on a lone card payment", () => {
    const date = `${AS_OF.slice(0, 7)}-16`;
    expect(billReminderAlerts(twoCards).map((a) => a.key)).toContain(`Credit card payment:${date}`);
    expect(billReminderAlerts(oneCard).map((a) => a.key)).toEqual([`Credit card payment:${date}`]);
  });
});
