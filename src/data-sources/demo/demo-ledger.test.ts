import { describe, expect, it } from "vitest";
import { DEMO_HISTORY_LOWEST_BANK_CENTS } from "@/config/net-worth";
import { PEOPLE } from "@/config/people";
import { personAccounts, personTransactions } from "./demo-people";
import type { DemoSeed } from "./demo-bank";

// The sample people's banks as a ledger (founder, 2026-10-23): every card payment is on both
// sides, and every balance rolls back through its own transactions to a believable one, so the
// net worth line is each person's real history.

const ANCHOR = "2026-10-23";
const THROUGH = "2026-10-22";
const MONTH_ENDS = [
  "2025-10-31",
  "2025-12-31",
  "2026-02-28",
  "2026-04-30",
  "2026-06-30",
  "2026-08-31",
  "2026-09-30",
];
const seedOf = (person: string) => ({ seed: "ledger", anchor: ANCHOR, person }) as DemoSeed;
const cents = (dollars: number) => Math.round(dollars * 100);

describe.each(PEOPLE.map((p) => p.id))("%s's bank", (person) => {
  const demo = seedOf(person);
  const accounts = personAccounts(demo);
  const transactions = personTransactions(demo, null, THROUGH);

  it("shows each card payment from checking on the card too", () => {
    const cards = new Set(accounts.filter((a) => a.type === "credit").map((a) => a.account_id));
    const payments = transactions.filter(
      (t) =>
        t.personal_finance_category?.detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" &&
        !cards.has(t.account_id),
    );
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) {
      const card = transactions.find(
        (t) => cards.has(t.account_id) && t.transaction_id === `${p.transaction_id}-card`,
      );
      expect(card, p.transaction_id).toBeDefined();
      expect(card!.amount).toBe(-p.amount);
      expect(card!.date).toBe(p.date);
    }
  });

  it("rolls every balance back to a believable one at each month end", () => {
    for (const a of accounts.filter((x) => ["depository", "credit"].includes(x.type))) {
      const own = transactions.filter((t) => t.account_id === a.account_id);
      const sign = a.type === "credit" ? -1 : 1;
      for (const end of MONTH_ENDS) {
        const since = own.filter((t) => t.date > end).reduce((s, t) => s + cents(t.amount), 0);
        const then = cents(a.balances.current!) + sign * since;
        expect(then, `${a.name} on ${end}`).toBeGreaterThanOrEqual(
          a.type === "credit" ? 0 : DEMO_HISTORY_LOWEST_BANK_CENTS,
        );
      }
    }
  });

  it("gives a later sync the same transactions as the first", () => {
    const later = personTransactions(demo, "2026-09-15", THROUGH);
    const same = transactions.filter((t) => t.date > "2026-09-15");
    expect(later).toEqual(same);
  });
});
