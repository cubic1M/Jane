import { describe, expect, it } from "vitest";
import type { BnplPlan } from "./bnpl";
import { debtBook, findDebt, sourceLabel, type DebtAccountInput } from "./debts";
import { netWorth } from "./net-worth";

const AS_OF = "2026-10-19";

const liability = (overrides: Partial<NonNullable<DebtAccountInput["liability"]>> = {}) => ({
  aprBps: null,
  rateType: null,
  minimumPaymentCents: null,
  nextPaymentDueDate: null,
  payoffDate: null,
  isOverdue: null,
  pastDueCents: null,
  description: null,
  ...overrides,
});

const account = (
  id: string,
  type: string,
  subtype: string | null,
  balance: number | null,
  l: DebtAccountInput["liability"] = null,
): DebtAccountInput => ({
  id,
  name: `Demo ${id}`,
  mask: null,
  type,
  subtype,
  currentBalanceCents: balance,
  liability: l,
});

const ACCOUNTS = [
  account(
    "card",
    "credit",
    "credit card",
    241_050,
    liability({
      aprBps: 2299,
      minimumPaymentCents: 3500,
      nextPaymentDueDate: new Date("2026-10-26"),
    }),
  ),
  account(
    "car",
    "loan",
    "auto",
    1_802_000,
    liability({
      aprBps: 690,
      rateType: "fixed",
      minimumPaymentCents: 49_410,
      payoffDate: new Date("2029-10-01"),
    }),
  ),
  account(
    "home",
    "loan",
    "mortgage",
    31_240_000,
    liability({ aprBps: 399, minimumPaymentCents: 214_154 }),
  ),
  // A card with no details from the bank, and one in credit.
  account("store", "credit", "credit card", 50_000),
  account("spare", "credit", "credit card", -2_500),
  account("checking", "depository", "checking", 384_012),
];

const KLARNA: BnplPlan = {
  key: "klarna:6225",
  provider: "klarna",
  providerName: "Klarna",
  kind: "pay_in_4",
  paymentCents: 6225,
  paymentsMade: 2,
  firstDate: "2026-10-02",
  lastDate: "2026-10-16",
  nextDate: "2026-10-30",
  paymentsLeft: 2,
  balanceCents: 12_450,
  payoffDate: "2026-11-13",
};
const AFFIRM: BnplPlan = {
  ...KLARNA,
  key: "affirm:8950",
  provider: "affirm",
  providerName: "Affirm",
  kind: "monthly",
  paymentCents: 8950,
  paymentsMade: 5,
  nextDate: "2026-10-31",
  paymentsLeft: null,
  balanceCents: null,
  payoffDate: null,
};

describe("every debt in one place", () => {
  it("adds up loans and cards to exactly what net worth counts as owed", () => {
    const book = debtBook({ accounts: ACCOUNTS, plans: [KLARNA], typed: [] }, AS_OF);
    const worth = netWorth(
      ACCOUNTS.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        balanceCents: a.currentBalanceCents,
      })),
    );
    expect(book.accountsOwedCents).toBe(worth.debtsCents);
    expect(book.bnplOwedCents).toBe(12_450);
    expect(book.totalOwedCents).toBe(worth.debtsCents + 12_450);
    // The checking account isn't a debt; a card in credit owes nothing.
    expect(book.debts.map((d) => d.accountId)).not.toContain("checking");
    expect(book.debts.find((d) => d.accountId === "spare")?.balanceCents).toBe(0);
  });

  it("says where every rate came from", () => {
    const book = debtBook({ accounts: ACCOUNTS, plans: [KLARNA, AFFIRM], typed: [] }, AS_OF);
    const by = (key: string) => book.debts.find((d) => d.key === key)!;
    expect(by("account:car")).toMatchObject({ aprBps: 690, aprFrom: "bank", rateType: "fixed" });
    expect(by("bnpl:klarna:6225")).toMatchObject({ aprBps: 0, aprFrom: "terms" });
    expect(by("bnpl:affirm:8950")).toMatchObject({ aprBps: null, aprFrom: null });
    expect(by("account:store")).toMatchObject({ aprBps: null, aprFrom: null });
    for (const debt of book.debts) {
      if (debt.aprBps !== null) expect(debt.aprFrom).not.toBeNull();
    }
    // The ones Jane asks about: money owed and no rate.
    expect(book.missingRate.map((d) => d.key).sort()).toEqual([
      "account:store",
      "bnpl:affirm:8950",
    ]);
  });

  it("fills only what the bank leaves out with typed terms", () => {
    const typed = [
      {
        debtKey: "account:store",
        aprBps: 2899,
        minimumPaymentCents: 2500,
        balanceCents: null,
        payoffDate: null,
        updatedOn: "2026-10-03",
      },
      // The bank's rate wins over a typed one.
      {
        debtKey: "account:car",
        aprBps: 100,
        minimumPaymentCents: null,
        balanceCents: null,
        payoffDate: null,
        updatedOn: "2026-10-03",
      },
      {
        debtKey: "bnpl:affirm:8950",
        aprBps: 1500,
        minimumPaymentCents: null,
        balanceCents: 53_700,
        payoffDate: "2027-04-01",
        updatedOn: "2026-10-03",
      },
    ];
    const book = debtBook({ accounts: ACCOUNTS, plans: [AFFIRM], typed }, AS_OF);
    const by = (key: string) => book.debts.find((d) => d.key === key)!;
    expect(by("account:store")).toMatchObject({
      aprBps: 2899,
      aprFrom: "typed",
      paymentCents: 2500,
      typedOn: "2026-10-03",
    });
    expect(by("account:car")).toMatchObject({ aprBps: 690, aprFrom: "bank", typedOn: null });
    expect(by("bnpl:affirm:8950")).toMatchObject({
      balanceCents: 53_700,
      balanceFrom: "typed",
      payoffDate: "2027-04-01",
      payoffFrom: "typed",
    });
    expect(book.bnplOwedCents).toBe(53_700);
    expect(book.bnplUnknown).toBe(0);
    expect(book.missingRate).toEqual([]);
  });

  it("adds up monthly payments, leaving out two-weekly Pay in 4", () => {
    const book = debtBook({ accounts: ACCOUNTS, plans: [KLARNA, AFFIRM], typed: [] }, AS_OF);
    expect(book.monthlyCents).toBe(3500 + 49_410 + 214_154 + 8950);
    // The two cards with nothing from the bank.
    expect(book.missingMonthly).toBe(2);
  });

  it("marks a payment due within a week", () => {
    const book = debtBook({ accounts: ACCOUNTS, plans: [], typed: [] }, AS_OF);
    expect(book.debts.find((d) => d.key === "account:card")?.dueSoon).toBe(true);
  });

  it("finds the debt the person means", () => {
    const { debts } = debtBook({ accounts: ACCOUNTS, plans: [KLARNA, AFFIRM], typed: [] }, AS_OF);
    expect(findDebt(debts, "my car")?.key).toBe("account:car");
    expect(findDebt(debts, "the house")?.key).toBe("account:home");
    expect(findDebt(debts, "klarna")?.key).toBe("bnpl:klarna:6225");
    expect(findDebt(debts, "Demo store")?.key).toBe("account:store");
    // The biggest card when there are several.
    expect(findDebt(debts, "credit card")?.key).toBe("account:card");
    expect(findDebt(debts, "boat")).toBeNull();
  });

  it("names every source in plain words", () => {
    expect(sourceLabel("bank")).toBe("from your bank");
    expect(sourceLabel("typed", "2026-10-03")).toBe("you typed it on Oct 3, 2026");
    expect(sourceLabel("terms")).toMatch(/no interest/);
    expect(sourceLabel("payments")).toBe("worked out from your payments");
    expect(sourceLabel(null)).toBe("not known yet");
  });
});

// Debugger 11-01: "Pennymac Loan Services Mortgage mortgage" on /loans: the lender's name already
// said what the loan was, and the kind was added again.
describe("a loan seen only in payments", () => {
  const paid = (lender: string, kind: "student" | "auto" | "mortgage") => ({
    key: `${kind}:${lender.toLowerCase()}`,
    lender,
    kind,
    paymentCents: 265_040,
    paymentsMade: 3,
    lastDate: "2026-10-01",
    nextDate: "2026-11-01",
  });
  const names = (...loans: ReturnType<typeof paid>[]) =>
    debtBook({ accounts: [], plans: [], typed: [], paid: loans }, AS_OF).debts.map((d) => d.name);

  it("says what it is once", () => {
    expect(
      names(
        paid("Pennymac Loan Services Mortgage", "mortgage"),
        paid("Navient Student Loan", "student"),
        paid("Toyota Motor Cr", "auto"),
      ).sort(),
    ).toEqual([
      "Navient Student Loan",
      "Pennymac Loan Services Mortgage",
      "Toyota Motor Cr car loan",
    ]);
  });
});
