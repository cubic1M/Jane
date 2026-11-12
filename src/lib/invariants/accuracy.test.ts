import { describe, expect, it } from "vitest";
import {
  addsUpChecks,
  balanceChecks,
  evidenceRefs,
  findingChecks,
  transactionChecks,
  type AccountRow,
  type TransactionRow,
} from "./accuracy";

const ASOF = "2026-11-05";
const checking: AccountRow = {
  id: "acct_checking",
  type: "depository",
  subtype: "checking",
  itemId: "item_one",
  mask: "4321",
  currentBalanceCents: 215000,
};
const card: AccountRow = {
  id: "acct_card",
  type: "credit",
  subtype: "credit card",
  itemId: "item_one",
  mask: "1111",
  currentBalanceCents: 43163,
};
let n = 0;
const tx = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: `row_${(n += 1)}`,
  accountId: checking.id,
  date: "2026-11-01",
  amountCents: 5000,
  description: "SAFEWAY STORE",
  pending: false,
  ...over,
});

describe("balance_matches_history", () => {
  it("passes an account whose balance moved by its transactions, and fails one that didn't", () => {
    const snaps = [
      { accountId: checking.id, date: "2026-11-01", balanceCents: 100000 },
      { accountId: checking.id, date: "2026-11-03", balanceCents: 95000 },
      { accountId: card.id, date: "2026-11-01", balanceCents: 10000 },
      { accountId: card.id, date: "2026-11-03", balanceCents: 30000 },
    ];
    // $50 out of checking between the two days; the card's $200 rise has no charges behind it.
    const txns = [
      tx({ date: "2026-11-02" }),
      tx({ accountId: card.id, date: "2026-11-02", amountCents: 1000 }),
    ];
    expect(balanceChecks([checking, card], snaps, txns)).toEqual({
      passed: 1,
      failed: 1,
      notApplicable: 0,
    });
  });

  it("counts an account with under two balances as not applicable, and ignores pending rows", () => {
    const snaps = [
      { accountId: checking.id, date: "2026-11-01", balanceCents: 100000 },
      { accountId: checking.id, date: "2026-11-03", balanceCents: 100000 },
    ];
    expect(
      balanceChecks([checking, card], snaps, [tx({ date: "2026-11-02", pending: true })]),
    ).toEqual({ passed: 1, failed: 0, notApplicable: 1 });
  });

  it("leaves out a copy of an account linked twice", () => {
    const copy = { ...checking, id: "acct_copy", itemId: "item_two" };
    const snaps = [
      { accountId: copy.id, date: "2026-11-01", balanceCents: 1 },
      { accountId: copy.id, date: "2026-11-03", balanceCents: 999 },
    ];
    expect(balanceChecks([checking, copy], snaps, [])).toEqual({
      passed: 0,
      failed: 0,
      notApplicable: 1,
    });
  });
});

describe("suggestion figures", () => {
  const stored = new Map([
    ["row_a", { amountCents: 1199, pending: false }],
    ["row_b", { amountCents: 1199, pending: false }],
    ["row_p", { amountCents: 1199, pending: true }],
  ]);
  const balances = new Map<string, number | null>([[checking.id, 215000]]);
  const charge = (id: string, amountCents = 1199) => ({
    id,
    date: "2026-10-12",
    amountCents,
    description: "SPOTIFY USA",
  });
  const subscription = (charges: unknown[]) => ({
    type: "subscription_review",
    amountCents: 14388,
    annualSavingsCents: 14388,
    evidence: { charges, frequency: "MONTHLY", annualCostCents: 14388 },
  });

  it("finds the transactions and balances evidence names, however deep", () => {
    expect(
      evidenceRefs({
        charges: [charge("row_a")],
        nested: { accounts: [{ id: checking.id, name: "Checking", balanceCents: 215000 }] },
      }),
    ).toEqual({
      transactions: [{ id: "row_a", amountCents: 1199 }],
      accounts: [{ id: checking.id, balanceCents: 215000 }],
    });
  });

  it("passes figures on rows still there at their amounts, and fails gone, changed or pending ones", () => {
    const result = findingChecks(
      [
        subscription([charge("row_a"), charge("row_b")]),
        subscription([charge("row_a"), charge("row_gone")]),
        subscription([charge("row_a"), charge("row_b", 999)]),
        subscription([charge("row_a"), charge("row_p")]),
        {
          type: "idle_cash",
          amountCents: 230906,
          annualSavingsCents: 8082,
          evidence: { accounts: [{ id: checking.id, balanceCents: 215000 }] },
        },
        {
          type: "idle_cash",
          amountCents: 230906,
          annualSavingsCents: 8082,
          evidence: { accounts: [{ id: checking.id, balanceCents: 100 }] },
        },
        // A figure with nothing to trace it to, and a finding with no figure.
        { type: "insurance_reshop", amountCents: null, annualSavingsCents: 30000, evidence: {} },
        { type: "low_balance_risk", amountCents: null, annualSavingsCents: null, evidence: {} },
      ],
      stored,
      balances,
    );
    expect(result.suggestion_figures_trace).toEqual({ passed: 2, failed: 4, notApplicable: 1 });
  });

  it("fails something recurring that rests on one charge", () => {
    const result = findingChecks(
      [subscription([charge("row_a"), charge("row_b")]), subscription([charge("row_a")])],
      stored,
      balances,
    );
    expect(result.recurring_two_occurrences).toEqual({ passed: 1, failed: 1, notApplicable: 0 });
  });
});

describe("transactions", () => {
  it("counts a second identical row as a duplicate, across accounts of one kind too", () => {
    const upload = { ...checking, id: "acct_upload", itemId: null, mask: null };
    const rows = [
      tx(),
      tx({ description: " safeway store " }),
      tx({ accountId: upload.id }),
      tx({ amountCents: 5001 }),
      tx({ accountId: card.id }),
    ];
    expect(
      transactionChecks([checking, card, upload], rows, ASOF).no_duplicate_transactions,
    ).toEqual({
      passed: 3,
      failed: 2,
      notApplicable: 0,
    });
  });

  it("fails pending rows past 14 days and rows dated after tomorrow", () => {
    const result = transactionChecks(
      [checking],
      [
        tx({ pending: true, date: "2026-10-22" }),
        tx({ pending: true, date: "2026-10-21" }),
        tx({ date: "2026-11-06" }),
        tx({ date: "2026-11-07" }),
      ],
      ASOF,
    );
    expect(result.no_stale_pending).toEqual({ passed: 1, failed: 1, notApplicable: 2 });
    expect(result.no_future_transactions).toEqual({ passed: 3, failed: 1, notApplicable: 0 });
  });
});

describe("areas_add_up_to_home", () => {
  const month = (
    spendingCents: number,
    categoriesCents: number[],
    refundsCents: number[] = [],
  ) => ({
    month: "2026-10",
    spendingCents,
    categoriesCents,
    refundsCents,
  });

  it("passes when Home and the Money page agree and each month's parts add up", () => {
    expect(
      addsUpChecks({
        homeNetWorthCents: 561837,
        moneyNetWorthCents: 561837,
        tileMonth: { month: "2026-11", spendingCents: 10506 },
        pageMonth: { month: "2026-11", spendingCents: 10506 },
        months: [month(124097, [95000, 29097, 6000], [-6000]), month(0, [1000], [-5000])],
      }).areas_add_up_to_home,
    ).toEqual({ passed: 4, failed: 0, notApplicable: 0 });
  });

  it("fails each disagreement, and skips what one side doesn't know", () => {
    expect(
      addsUpChecks({
        homeNetWorthCents: 561837,
        moneyNetWorthCents: 1123674,
        tileMonth: { month: "2026-11", spendingCents: 10506 },
        pageMonth: { month: "2026-11", spendingCents: 21012 },
        months: [month(124097, [95000, 29096])],
      }).areas_add_up_to_home,
    ).toEqual({ passed: 0, failed: 3, notApplicable: 0 });
    expect(
      addsUpChecks({
        homeNetWorthCents: null,
        moneyNetWorthCents: 0,
        tileMonth: { month: "2026-11", spendingCents: 0 },
        pageMonth: { month: "2026-10", spendingCents: 1 },
        months: [],
      }).areas_add_up_to_home,
    ).toEqual({ passed: 0, failed: 0, notApplicable: 2 });
  });
});
