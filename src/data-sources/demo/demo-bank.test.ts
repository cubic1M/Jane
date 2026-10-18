import { describe, expect, it } from "vitest";
import { PFC_TAXONOMY } from "@/categorize/taxonomy";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import { normalizeAccount } from "@/data-sources/plaid/plaid-source";
import { addDays, demoAccounts, demoLiabilities, demoTransactions } from "./demo-bank";

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

  it("reports loans with due dates after today", () => {
    const loans = normalizeLiabilities(demoLiabilities(DEMO, "2026-10-18"));
    expect(loans.map((l) => l.kind)).toEqual(["credit", "mortgage", "student", "loan"]);
    for (const l of loans) {
      expect(l.aprBps).not.toBeNull();
      expect(l.nextPaymentDueDate! > "2026-10-18").toBe(true);
    }
  });
});
