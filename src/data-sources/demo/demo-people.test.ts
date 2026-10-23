import { describe, expect, it } from "vitest";
import { PEOPLE, SUGGESTION_TOPICS } from "@/config/people";
import { addDays, demoAccounts, demoLiabilities, demoTransactions } from "./demo-bank";
import { demoHoldings, demoInvestmentTransactions } from "./demo-holdings";

// Spec step 252: eight sample people, each a full demo bank. Built from the same code as the
// original demo bank, so they sync the same way.

const ANCHOR = "2026-10-18";
const THROUGH = "2026-10-17";
const seedOf = (person: string) => ({ seed: `seed${person}`, anchor: ANCHOR, person });
const txns = (person: string) => demoTransactions(seedOf(person), null, THROUGH);
const names = (person: string) => new Set(txns(person).map((t) => t.name));
const has = (person: string, pattern: RegExp) => txns(person).some((t) => pattern.test(t.name));

describe("the eight sample people", () => {
  it("has eight, with written lists that use known topics and never contradict", () => {
    expect(PEOPLE).toHaveLength(8);
    for (const p of PEOPLE) {
      expect(p.should.length, p.id).toBeGreaterThan(2);
      expect(p.mustNot.length, p.id).toBeGreaterThan(2);
      for (const t of [...p.should, ...p.mustNot]) expect(SUGGESTION_TOPICS).toContain(t);
      expect(
        p.should.filter((t) => p.mustNot.includes(t)),
        p.id,
      ).toEqual([]);
    }
  });

  it.each(PEOPLE.map((p) => p.id))("%s has a year of transactions on their own accounts", (id) => {
    const demo = seedOf(id);
    const t = txns(id);
    expect(t.length).toBeGreaterThan(200);
    expect(demoTransactions(demo, null, THROUGH)).toEqual(t);
    expect(new Set(t.map((x) => x.transaction_id)).size).toBe(t.length);
    expect(t[0].date > addDays(THROUGH, -365)).toBe(true);
    const accountIds = new Set(demoAccounts(demo).map((a) => a.account_id));
    for (const x of t) expect(accountIds.has(x.account_id), x.name).toBe(true);
    // Only the days since the last sync are added.
    const later = demoTransactions(demo, THROUGH, "2026-11-20");
    expect(later.every((x) => x.date > THROUGH)).toBe(true);
  });

  it.each(PEOPLE.map((p) => p.id))("%s holds what their accounts say", (id) => {
    const demo = seedOf(id);
    const investmentIds = new Set(
      demoAccounts(demo)
        .filter((a) => a.type === "investment")
        .map((a) => a.account_id),
    );
    const holdings = demoHoldings(demo, THROUGH);
    for (const h of holdings) expect(investmentIds.has(h.account_id)).toBe(true);
    expect(demoInvestmentTransactions(demo, "2025-10-01", THROUGH)).toEqual([]);
    // Every investment account holds something, even if only cash.
    expect(new Set(holdings.map((h) => h.account_id)).size).toBe(investmentIds.size);
  });

  it("builds each life as written", () => {
    // Maya: renting, a card balance carrying interest, overdrafts, several subscriptions.
    expect(has("renter", /APARTMENTS/)).toBe(true);
    expect(has("renter", /OVERDRAFT/)).toBe(true);
    expect(has("renter", /INTEREST CHARGE/)).toBe(true);
    // The family: two paychecks, childcare, a mortgage with PMI.
    // The second earner changed jobs two months ago, so three payrolls in the year.
    expect([...names("family")].filter((n) => /PAYROLL/.test(n))).toHaveLength(3);
    expect(has("family", /BRIGHT HORIZONS/)).toBe(true);
    expect(demoLiabilities(seedOf("family"), THROUGH).mortgage?.[0].has_pmi).toBe(true);
    // The freelancer: clients, no payroll, no tax payment.
    expect(has("freelancer", /STRIPE|PAYPAL|ZELLE/)).toBe(true);
    expect(has("freelancer", /PAYROLL/)).toBe(false);
    expect(has("freelancer", /REVENUE|IRS/)).toBe(false);
    // Priya: a stock plan with company shares, lots of cash.
    expect(demoAccounts(seedOf("equity")).some((a) => a.subtype === "stock plan")).toBe(true);
    expect(
      demoAccounts(seedOf("equity")).find((a) => a.subtype === "savings")?.balances.current,
    ).toBeGreaterThan(80_000);
    // The couple near retirement: two paychecks and a nearly paid-off home.
    expect(demoLiabilities(seedOf("preretire"), THROUGH).mortgage?.[0].maturity_date).toMatch(
      /^2031/,
    );
    // Ruth: Social Security, a pension, IRA withdrawals, Medicare.
    for (const pattern of [/SSA TREAS/, /TEACHERS RETIREMENT/, /IRA DISTRIBUTION/, /MEDICARE/]) {
      expect(has("retiree", pattern), String(pattern)).toBe(true);
    }
    // Chris: many overdrafts and late fees, a payday loan, three cards near their limits.
    expect(txns("debt").filter((t) => /OVERDRAFT/.test(t.name)).length).toBeGreaterThanOrEqual(5);
    expect(has("debt", /ADVANCE AMERICA/)).toBe(true);
    expect(demoLiabilities(seedOf("debt"), THROUGH).credit).toHaveLength(3);
    // Jo: sales deposits, payroll for staff, business and home on one account.
    expect(has("owner", /SQUARE DEPOSIT/)).toBe(true);
    expect(has("owner", /GUSTO/)).toBe(true);
  });

  it("leaves the original demo bank as it was", () => {
    const original = { seed: "abc123", anchor: ANCHOR };
    expect(demoAccounts(original)).toHaveLength(8);
    expect(demoTransactions(original, null, THROUGH).length).toBeGreaterThan(400);
  });
});
