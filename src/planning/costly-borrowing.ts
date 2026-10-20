import { ASSUMED, COSTLY_CYCLE_DAYS, type CostlyKind } from "@/config/costly-borrowing";

// Out of costly short-term borrowing (spec step 247). Pure: which payments are a payday loan, a
// card cash advance, an overdraft or a pay advance app, what each kind cost over the year in
// dollars, and the yearly rate that works out to.

export type Tx = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  pfcDetailed: string | null;
  // The account is a credit card.
  card: boolean;
};

const PAYDAY_NAMES =
  /payday|advance america|check into cash|check ?n ?go|speedy cash|ace cash|cash store|lendnation|moneytree|cashnet|net ?credit|loan by phone|rapid cash/i;
const PAY_APP_NAMES =
  /earnin|dave\b|brigit|empower|moneylion|klover|albert|chime.*(?:instant|mypay)|payactiv|branch.*advance|cash ?app.*borrow/i;

export function kindOf(t: Tx): CostlyKind | null {
  const d = t.pfcDetailed ?? "";
  if (d === "BANK_FEES_OVERDRAFT_FEES" || d === "BANK_FEES_INSUFFICIENT_FUNDS") return "overdraft";
  if (d.endsWith("_EWA") || PAY_APP_NAMES.test(t.description)) return "pay_app";
  if (d === "BANK_FEES_CASH_ADVANCE" || (t.card && /cash (?:adv|advance)/i.test(t.description))) {
    return "cash_advance";
  }
  if (d.endsWith("_CASH_ADVANCES") || PAYDAY_NAMES.test(t.description)) return "payday";
  return null;
}

export type Loan = {
  kind: "payday" | "pay_app";
  lender: string;
  principalCents: number;
  repaidCents: number;
  feeCents: number;
  takenOn: string;
  days: number;
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Proceeds (money in) matched to the next repayment (money out) from the same lender, within
// 60 days. For a pay advance app the tips and fees that day add to what was repaid.
export function pairLoans(txs: readonly Tx[]): { loans: Loan[]; open: Tx[] } {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const loans: Loan[] = [];
  const open: Tx[] = [];
  const used = new Set<string>();
  const nameOf = (t: Tx) =>
    t.description
      .replace(/\b(?:loan|proceeds|payment|advance|repayment|tip|fee|deposit)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  for (const t of sorted) {
    const kind = kindOf(t);
    if ((kind !== "payday" && kind !== "pay_app") || t.amountCents >= 0) continue;
    const lender = nameOf(t);
    const repay = sorted.find(
      (r) =>
        !used.has(r.id) &&
        r.amountCents > 0 &&
        kindOf(r) === kind &&
        r.date >= t.date &&
        daysBetween(t.date, r.date) <= 60 &&
        nameOf(r).toLowerCase() === lender.toLowerCase() &&
        // A tip or fee is not the repayment.
        !/tip|fee/i.test(r.description),
    );
    if (!repay) {
      open.push(t);
      continue;
    }
    used.add(repay.id);
    const principalCents = -t.amountCents;
    // A pay advance app: tips and fees on the repayment day or the next few days.
    const extras = sorted.filter(
      (f) =>
        !used.has(f.id) &&
        kindOf(f) === kind &&
        f.amountCents > 0 &&
        /tip|fee/i.test(f.description) &&
        nameOf(f).toLowerCase() === lender.toLowerCase() &&
        daysBetween(repay.date, f.date) >= 0 &&
        daysBetween(repay.date, f.date) <= 3,
    );
    for (const f of extras) used.add(f.id);
    const repaidCents = repay.amountCents + extras.reduce((s, f) => s + f.amountCents, 0);
    loans.push({
      kind,
      lender,
      principalCents,
      repaidCents,
      feeCents: Math.max(0, repaidCents - principalCents),
      takenOn: t.date,
      days: Math.max(1, daysBetween(t.date, repay.date)),
    });
  }
  return { loans, open };
}

export type KindSummary = {
  kind: CostlyKind;
  count: number;
  // Fees and interest over the period, in dollars.
  costCents: number;
  // The yearly rate that works out to (basis points), and how it was worked out.
  aprBps: number | null;
  basis: string;
  lastOn: string | null;
};

const apr = (costCents: number, principalDays: number) =>
  principalDays > 0 ? Math.round(((costCents * 365) / principalDays) * 10_000) : null;

export type Costly = {
  kinds: KindSummary[];
  totalYearlyCents: number;
  // Payday loans (or pay advances) taken again and again.
  cycle: boolean;
  loans: Loan[];
};

export function summarize(txs: readonly Tx[], today: string): Costly {
  const classified = txs.map((t) => ({ t, kind: kindOf(t) })).filter((x) => x.kind !== null);
  const by = (k: CostlyKind) => classified.filter((x) => x.kind === k).map((x) => x.t);
  const out: KindSummary[] = [];

  const paydayTxs = by("payday");
  const payday = pairLoans(paydayTxs);
  if (payday.loans.length > 0) {
    const cost = payday.loans.reduce((s, l) => s + l.feeCents, 0);
    const pd = payday.loans.reduce((s, l) => s + l.principalCents * l.days, 0);
    out.push({
      kind: "payday",
      count: payday.loans.length,
      costCents: cost,
      aprBps: apr(cost, pd),
      basis: "the fee on each loan over the days it was out",
      lastOn: payday.loans.at(-1)!.takenOn,
    });
  }

  const adv = by("cash_advance");
  const fees = adv.filter(
    (t) => t.pfcDetailed === "BANK_FEES_CASH_ADVANCE" || /fee/i.test(t.description),
  );
  const advances = adv.filter((t) => !fees.includes(t));
  if (fees.length + advances.length > 0) {
    const principal = advances.reduce((s, t) => s + Math.max(0, t.amountCents), 0);
    const feeSum = fees.reduce((s, t) => s + t.amountCents, 0);
    // Interest from day one at the card's rate, for the assumed days.
    const interest = Math.round(
      (principal * ASSUMED.cashAdvanceAprBps * ASSUMED.cashAdvanceDays) / 10_000 / 365,
    );
    const cost = feeSum + interest;
    out.push({
      kind: "cash_advance",
      count: Math.max(advances.length, fees.length),
      costCents: cost,
      aprBps: apr(cost, principal * ASSUMED.cashAdvanceDays),
      basis: `the fee plus interest from day one at ${ASSUMED.cashAdvanceAprBps / 100}%, over about ${ASSUMED.cashAdvanceDays} days`,
      lastOn:
        [...fees, ...advances]
          .map((t) => t.date)
          .sort()
          .at(-1) ?? null,
    });
  }

  const od = by("overdraft").filter((t) => t.amountCents > 0);
  if (od.length > 0) {
    const cost = od.reduce((s, t) => s + t.amountCents, 0);
    out.push({
      kind: "overdraft",
      count: od.length,
      costCents: cost,
      aprBps: apr(cost, od.length * ASSUMED.overdraftCents * ASSUMED.overdraftDays),
      basis: `each fee on a $${ASSUMED.overdraftCents / 100} overdraft covered for about ${ASSUMED.overdraftDays} days`,
      lastOn:
        od
          .map((t) => t.date)
          .sort()
          .at(-1) ?? null,
    });
  }

  const appTxs = by("pay_app");
  const apps = pairLoans(appTxs);
  const loose = appTxs.filter(
    (t) => t.amountCents > 0 && /tip|fee/i.test(t.description) && !apps.loans.length,
  );
  if (apps.loans.length > 0 || loose.length > 0) {
    const cost =
      apps.loans.reduce((s, l) => s + l.feeCents, 0) + loose.reduce((s, t) => s + t.amountCents, 0);
    const pd = apps.loans.length
      ? apps.loans.reduce((s, l) => s + l.principalCents * l.days, 0)
      : loose.length * ASSUMED.payAppCents * ASSUMED.payAppDays;
    out.push({
      kind: "pay_app",
      count: Math.max(apps.loans.length, loose.length),
      costCents: cost,
      aprBps: apr(cost, pd),
      basis: apps.loans.length
        ? "the tips and fees on each advance over the days it was out"
        : `each tip or fee on a $${ASSUMED.payAppCents / 100} advance for about ${ASSUMED.payAppDays} days`,
      lastOn:
        appTxs
          .map((t) => t.date)
          .sort()
          .at(-1) ?? null,
    });
  }

  const cycle =
    [...payday.loans, ...apps.loans].filter(
      (l) => daysBetween(l.takenOn, today) <= COSTLY_CYCLE_DAYS,
    ).length >= 2;
  return {
    kinds: out.sort((a, b) => b.costCents - a.costCents),
    totalYearlyCents: out.reduce((s, k) => s + k.costCents, 0),
    cycle,
    loans: [...payday.loans, ...apps.loans],
  };
}

// What borrowing `amountCents` over `months` months would cost at `aprBps`, with the fee: the
// level payment, total interest. For a comparison with a PAL.
export function loanCost(amountCents: number, aprBps: number, months: number, feeCents = 0) {
  const r = aprBps / 10_000 / 12;
  const payment =
    r === 0
      ? Math.ceil(amountCents / months)
      : Math.ceil((amountCents * r) / (1 - (1 + r) ** -months));
  return { paymentCents: payment, interestCents: payment * months - amountCents + feeCents };
}
