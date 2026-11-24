import { describe, expect, it } from "vitest";
import { buildProfile, payMonths, type ProfileInput, type ProfileTx } from "./build";
import { choiceWords } from "./facts";
import { employerName } from "./employer-name";
import { sideGigReading } from "./life-facts";

// CodeRabbit sweep, part 1 (money figures), src/profile: each case is a finding reproduced
// against the code first (failing), then fixed.

const TODAY = "2026-06-15";
const CHECKING = { id: "chk", type: "depository", subtype: "checking", balanceCents: 0 };
const CARD = { id: "cc", type: "credit", subtype: "credit card", balanceCents: 200_000 };

const months = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 10);
  });

const paychecks = (cents: number): ProfileTx[] =>
  months("2025-07-01", 12).map((date) => ({
    date,
    amountCents: -cents,
    description: "ACME CORP PAYROLL",
    pfc: "INCOME_SALARY",
    accountId: "chk",
  }));

const input = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  today: TODAY,
  transactions: paychecks(200_000),
  accounts: [CHECKING, CARD],
  liabilities: [],
  told: {},
  ...over,
});

const liability = (minimumCents: number | null) => ({
  accountId: "cc",
  kind: "credit",
  aprBps: 2400,
  hasPmi: null,
  payoffDate: null,
  minimumCents,
});

describe("card debt in the profile (CodeRabbit sweep 1)", () => {
  it("uses a card's reported minimum before estimating it at 3% of the balance", () => {
    // $2,000 owed, $900 due a month on $2,000 of pay and no cash: 45% of income, over the 40% line.
    const reported = buildProfile(input({ liabilities: [liability(90_000)] }));
    expect(reported.facts.debt_trouble.value).toBe(true);
    // No minimum reported: the 3% estimate ($60) stays the fallback, no trouble.
    const estimated = buildProfile(input({ liabilities: [liability(null)] }));
    expect(estimated.facts.debt_trouble.value).toBe(false);
  });

  it("does not report a card whose balance is unknown as $0 owed", () => {
    const unknownBalance = { ...CARD, balanceCents: 0, balanceKnown: false };
    const fact = buildProfile(input({ accounts: [CHECKING, unknownBalance] })).facts
      .card_debt_cents;
    expect(fact.value).toBeNull();
    // A reported zero is still $0.
    const zero = { ...CARD, balanceCents: 0, balanceKnown: true };
    expect(buildProfile(input({ accounts: [CHECKING, zero] })).facts.card_debt_cents.value).toBe(0);
  });

  it("totals the cards whose balance is known when another card's is not", () => {
    const unknownBalance = {
      id: "cc2",
      type: "credit",
      subtype: "credit card",
      balanceCents: 0,
      balanceKnown: false,
    };
    const fact = buildProfile(input({ accounts: [CHECKING, CARD, unknownBalance] })).facts
      .card_debt_cents;
    expect(fact.value).toBe(200_000);
  });

  it("judges debt trouble by the income the person corrected to", () => {
    // Detected $2,000 a month; $7,000 on cards is over three months of that. They say $5,000.
    const owed = { ...CARD, balanceCents: 700_000 };
    const detected = buildProfile(input({ accounts: [CHECKING, owed] }));
    expect(detected.facts.debt_trouble.value).toBe(true);
    const corrected = buildProfile(
      input({ accounts: [CHECKING, owed], told: { monthly_income: 500_000 } }),
    );
    expect(corrected.facts.monthly_income.value).toBe(500_000);
    expect(corrected.facts.debt_trouble.value).toBe(false);
  });
});

describe("small readings in the profile (CodeRabbit sweep 1)", () => {
  it("choiceWords ignores inherited object keys", () => {
    expect(choiceWords("constructor", "housing")).not.toEqual(expect.any(Function));
    expect(typeof choiceWords("constructor", "housing")).toBe("string");
  });

  it("employerName strips the deposit date even with trailing spaces", () => {
    expect(employerName("ACME 03/15 ")).toBe(employerName("ACME 03/15"));
    expect(employerName("ACME 03/15 ")).toBe("ACME");
  });

  it("a transfer the bank files as a transfer is not a side gig", () => {
    const row = (date: string) => ({
      date,
      amountCents: -50_000,
      description: "PAYPAL TRANSFER",
      pfc: "TRANSFER_IN_ACCOUNT_TRANSFER",
    });
    const txs = [row("2026-01-05"), row("2026-02-05"), row("2026-02-20")];
    expect(sideGigReading(txs, true).value).toBe(false);
    // The same words filed as gig income still count.
    const gig = txs.map((t) => ({ ...t, pfc: "INCOME_GIG_ECONOMY" }));
    expect(sideGigReading(gig, true).value).toBe(true);
  });
});

describe("pay months (CodeRabbit sweep 1)", () => {
  it("holds still when no new line arrives (no jump at 12 months)", () => {
    const txs: ProfileTx[] = [
      { date: "2025-01-01", amountCents: 1000, description: "A", pfc: null, accountId: "chk" },
      { date: "2025-12-16", amountCents: 1000, description: "B", pfc: null, accountId: "chk" },
    ];
    const dec16 = payMonths(txs, "2025-12-16");
    for (const today of ["2025-12-20", "2025-12-25", "2025-12-31", "2026-01-05"])
      expect(payMonths(txs, today)).toBeCloseTo(dec16, 5);
  });
});

describe("what the profile reads from payments (CodeRabbit sweep 1)", () => {
  const out = (
    date: string,
    description: string,
    pfc: string | null = null,
    cents = 2_000,
  ): ProfileTx => ({
    date,
    amountCents: cents,
    description,
    pfc,
    accountId: "chk",
  });

  it("does not count the same school payments as a kids' store as well", () => {
    // Four school lunches in three months: school needs 3 in 2 months, the store rule 4 in 3.
    const lunches = ["2026-03-02", "2026-04-02", "2026-04-20", "2026-05-02"].map((d) =>
      out(d, "KIDS SCHOOL LUNCH"),
    );
    const fact = buildProfile(input({ transactions: [...paychecks(200_000), ...lunches] })).facts
      .has_children;
    // One kind of payment, said once: a guess, not "seen" through two kinds.
    expect(fact.source).toBe("guessed");
    expect(fact.evidence).not.toMatch(/8 /);
  });

  it("needs baby goods in two months, not three purchases on one day", () => {
    const diapers = ["2026-06-10", "2026-06-10", "2026-06-10"].map((d) => out(d, "DIAPERS BABY"));
    const fact = buildProfile(input({ transactions: [...paychecks(200_000), ...diapers] })).facts
      .new_baby;
    expect(fact.value).toBe(false);
  });

  it("does not take an incoming refund from a parts store for a car", () => {
    const refund: ProfileTx = {
      date: "2026-06-01",
      amountCents: -4_000,
      description: "AUTOZONE REFUND",
      pfc: "GENERAL_MERCHANDISE_OTHER",
      accountId: "chk",
    };
    const fact = buildProfile(input({ transactions: [...paychecks(200_000), refund] })).facts
      .has_car;
    expect(fact.value).toBe(false);
  });

  it("spreads health spending over the observed span, not the count of months it touched", () => {
    // Six medical payments, $800, February 1 to May 15: 3.42 months of data, $234 a month.
    const dates = [
      "2026-02-01",
      "2026-03-05",
      "2026-03-20",
      "2026-04-10",
      "2026-05-01",
      "2026-05-15",
    ];
    const medical = dates.map((d, i) =>
      out(d, "CLINIC", "MEDICAL_PRIMARY_CARE", i < 4 ? 13_333 : 13_334),
    );
    const salary = ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"].map(
      (date): ProfileTx => ({
        date,
        amountCents: -200_000,
        description: "ACME CORP PAYROLL",
        pfc: "INCOME_SALARY",
        accountId: "chk",
      }),
    );
    const fact = buildProfile(input({ today: "2026-05-16", transactions: [...salary, ...medical] }))
      .facts.health_costs;
    expect(fact.value).toBe(false);
  });
});
