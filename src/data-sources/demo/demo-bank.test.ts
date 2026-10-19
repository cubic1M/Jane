import { describe, expect, it } from "vitest";
import { PFC_TAXONOMY } from "@/categorize/taxonomy";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import { normalizeAccount } from "@/data-sources/plaid/plaid-source";
import {
  addDays,
  demoAccounts,
  demoLiabilities,
  demoSwitchTransactions,
  demoTransactions,
} from "./demo-bank";

const DEMO = { seed: "abc123", anchor: "2026-10-18" };
const THROUGH = "2026-10-17";

describe("the demo bank", () => {
  it("makes a year of transactions, the same every time", () => {
    const first = demoTransactions(DEMO, null, THROUGH);
    expect(first.length).toBeGreaterThan(400);
    expect(demoTransactions(DEMO, null, THROUGH)).toEqual(first);
    expect(first[0].date > addDays(THROUGH, -365)).toBe(true);
    expect(first.at(-1)!.date <= THROUGH).toBe(true);
    expect(new Set(first.map((t) => t.transaction_id)).size).toBe(first.length);
  });

  it("only adds the days since the last sync, so nothing is duplicated", () => {
    // Everything from the first sync's start through a month later.
    const all = demoTransactions(DEMO, addDays(THROUGH, -365), "2026-11-20");
    const firstSync = demoTransactions(DEMO, null, THROUGH);
    const later = demoTransactions(DEMO, THROUGH, "2026-11-20");
    expect(later.every((t) => t.date > THROUGH)).toBe(true);
    expect(new Set([...firstSync, ...later].map((t) => t.transaction_id))).toEqual(
      new Set(all.map((t) => t.transaction_id)),
    );
  });

  it("keeps ids apart between people", () => {
    const mine = demoTransactions(DEMO, null, THROUGH).map((t) => t.transaction_id);
    const theirs = demoTransactions({ ...DEMO, seed: "zzz999" }, null, THROUGH).map(
      (t) => t.transaction_id,
    );
    expect(mine.some((id) => theirs.includes(id))).toBe(false);
    expect(demoAccounts(DEMO)[0].account_id).not.toBe(
      demoAccounts({ ...DEMO, seed: "zzz999" })[0].account_id,
    );
  });

  it("uses real Plaid categories and accounts the app understands", () => {
    const categories = new Set(Object.values(PFC_TAXONOMY).flat() as string[]);
    for (const t of demoTransactions(DEMO, null, THROUGH)) {
      expect(categories.has(t.personal_finance_category!.detailed), t.name).toBe(true);
    }
    expect(demoAccounts(DEMO).map((a) => normalizeAccount(a)?.kind)).toEqual([
      "checking",
      "savings",
      "credit_card",
      "mortgage",
      "student_loan",
      "auto_loan",
      "retirement",
      "investment_account",
    ]);
  });

  it("puts in what each finding needs: a recent price rise, a trial, a duplicate", () => {
    const rows = demoTransactions(DEMO, null, THROUGH);
    const netflix = rows.filter((t) => t.merchant_name === "Netflix").map((t) => t.amount);
    expect(netflix.at(-1)).toBe(17.99);
    expect(netflix.at(-2)).toBe(15.49);
    expect(rows.filter((t) => t.merchant_name === "Target").map((t) => t.date)).toEqual([
      "2026-10-15",
      "2026-10-16",
    ]);
    expect(rows.filter((t) => t.merchant_name === "MasterClass").map((t) => t.amount)).toEqual([
      1, 120,
    ]);
  });

  it("puts in a big recent purchase and a trial for /deadlines", () => {
    const rows = demoTransactions(DEMO, null, THROUGH);
    expect(rows.filter((t) => t.merchant_name === "Apple")).toEqual([
      expect.objectContaining({ date: "2026-10-16", amount: 1349 }),
    ]);
    expect(rows.filter((t) => t.merchant_name === "Paramount+")).toEqual([
      expect.objectContaining({ date: "2026-10-12", amount: 0.99 }),
    ]);
  });

  it("has a card minimum that covers a month of interest, so paying it never grows the balance", () => {
    const [card] = demoLiabilities(DEMO, "2026-10-18").credit!;
    const purchase = card.aprs!.find((a) => a.apr_type === "purchase_apr")!;
    const monthlyInterest =
      (purchase.balance_subject_to_apr! * purchase.apr_percentage!) / 100 / 12;
    expect(monthlyInterest).toBeGreaterThan(46);
    expect(card.minimum_payment_amount!).toBeGreaterThan(monthlyInterest);
  });

  it("reports loans with due dates after today", () => {
    const loans = normalizeLiabilities(demoLiabilities(DEMO, "2026-10-18"));
    expect(loans.map((l) => l.kind)).toEqual(["credit", "mortgage", "student", "loan"]);
    for (const l of loans) {
      expect(l.aprBps).not.toBeNull();
      expect(l.nextPaymentDueDate! > "2026-10-18").toBe(true);
    }
  });
});

describe("the demo bank after a switch", () => {
  const sw = {
    actionId: "act1",
    kind: "plan" as const,
    provider: "Pine Mobile",
    company: "Verizon Wireless",
    category: "phone",
    monthlyCents: 3_500,
    amountCents: null,
    startDay: "2026-10-18",
  };

  it("sends the new provider's first bill two days later, once", () => {
    expect(demoSwitchTransactions(DEMO, [sw], "2026-10-18", "2026-10-19")).toEqual([]);
    const [bill] = demoSwitchTransactions(DEMO, [sw], "2026-10-18", "2026-10-20");
    expect(bill).toMatchObject({
      date: "2026-10-20",
      amount: 35,
      merchant_name: "Pine Mobile",
      personal_finance_category: { detailed: "RENT_AND_UTILITIES_TELEPHONE" },
    });
    expect(demoSwitchTransactions(DEMO, [sw], "2026-10-20", "2026-10-25")).toEqual([]);
  });

  it("shows a cheaper tier as the same service, and savings as money moving out", () => {
    const [tier] = demoSwitchTransactions(
      DEMO,
      [
        {
          ...sw,
          kind: "tier",
          provider: "Netflix",
          company: "Netflix",
          category: null,
          monthlyCents: 799,
        },
      ],
      null,
      "2026-10-25",
    );
    expect(tier).toMatchObject({ merchant_name: "Netflix", amount: 7.99 });
    const [moved] = demoSwitchTransactions(
      DEMO,
      [
        {
          ...sw,
          kind: "savings",
          provider: "Cobalt Bank",
          monthlyCents: null,
          amountCents: 1_500_000,
        },
      ],
      null,
      "2026-10-25",
    );
    expect(moved).toMatchObject({
      amount: 15_000,
      account_id: "demo-abc123-savings",
      personal_finance_category: { primary: "TRANSFER_OUT" },
    });
  });

  // Spec step 70.
  it("has yearly and seasonal costs: car registration once, gifts in November and December", () => {
    const rows = demoTransactions(DEMO, null, THROUGH);
    expect(rows.filter((t) => t.merchant_name === "California DMV").map((t) => t.date)).toEqual([
      addDays(DEMO.anchor, -150),
    ]);
    const gifts = rows.filter((t) => t.merchant_name === "Etsy").map((t) => t.date.slice(5, 7));
    expect(new Set(gifts)).toEqual(new Set(["11", "12"]));
  });
});
