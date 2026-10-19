import {
  FILING_STATUSES,
  INCOME_KINDS,
  TAXABLE_INVESTMENT_SUBTYPES,
  type FilingStatus,
} from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoPayroll } from "@/lib/payroll/demo";
import { hasDemoBank } from "@/lib/plaid/demo";
import { loadTaxTags } from "@/lib/tax-organizer";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { estimateTaxes, type EstimateInput, type TaxEstimate } from "@/planning/tax-estimate";
import { perPaycheckEffect, type W4Step } from "@/planning/withholding";
import { homeOfficeDeduction, mileageDeduction } from "@/planning/self-employed";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import {
  NO_PAY,
  payFrequency,
  paychecksLeft,
  otherIncomeSoFar,
  payFromStubs,
  payFromYtd,
  projectOther,
  taxPaymentsFor,
  yearElapsed,
  type PayPicture,
} from "@/planning/tax-income";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName, type ProfileField } from "@/planning/tax-profile";

// The tax estimate (spec step 120), loaded from the person's own accounts, pay stubs and
// tax profile: what they'll owe or get back for the year, federal and state. Worked out
// fresh each time, so it's up to date after every sync. Every figure is an estimate.

type Options = { client?: PrismaClient; now?: Date };

export type TaxEstimateView = {
  year: number;
  // How much of the year has gone (1 once it's over).
  elapsed: number;
  // Income so far this year (wages as federal wages, or take-home pay without pay stubs).
  incomeSoFarCents: number;
  estimate: TaxEstimate;
  pay: PayPicture;
  // False when Jane can see paychecks but not what was withheld: she can say the tax, not
  // whether it's a refund.
  withholdingKnown: boolean;
  // Everything Jane assumed, said plainly.
  assumptions: string[];
  // Profile fields filled in from what Jane found, not yet checked.
  unconfirmed: ProfileField[];
  // Spec step 121: paydays, the W-4 change the person sent, their choice to keep a refund
  // this year, and last year's federal refund as it arrived.
  paychecks: {
    // Paychecks so far this year.
    count: number;
    perYear: number | null;
    left: number;
    last: string | null;
    withheldPerPaycheckCents: number;
  };
  w4: { step: W4Step; amountCents: number; changedOn: string } | null;
  // Spec step 122: what the estimate was worked out from, for what-ifs.
  input: EstimateInput;
  keepRefundYear: number | null;
  lastYearRefundCents: number | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadTaxEstimate(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    year: asked,
  }: Options & {
    // Spec step 125: a past year, to match a refund to; the usual tax year otherwise.
    year?: number;
  } = {},
): Promise<TaxEstimateView> {
  const today = iso(now);
  const year = asked ?? defaultTaxYear(today);
  const db = scopedFor(userId, client);
  const incomeCategories = [
    ...Object.values(INCOME_KINDS).flatMap((k) => [...k.categories]),
    "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    // Spec step 121: last year's refund, as it arrived this year.
    "INCOME_TAX_REFUND",
  ];
  const [{ view, profile }, demo, transactions, accounts, investmentCash, loans, tags, stored] =
    await Promise.all([
      loadWorkingProfile(userId, { client, now }),
      hasDemoBank(userId, { client }),
      db.transactions.findMany({
        where: {
          pending: false,
          pfcDetailed: { in: incomeCategories },
          date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 1, 1)) },
        },
        select: {
          date: true,
          amountCents: true,
          pfcDetailed: true,
          description: true,
          merchantName: true,
        },
      }),
      db.accounts.findMany({ where: { type: "investment" }, select: { id: true, subtype: true } }),
      db.investmentTransactions.findMany({
        where: {
          type: "cash",
          date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
        select: { date: true, amountCents: true, subtype: true, accountId: true },
      }),
      // Banks report loan interest for the current year only.
      year === now.getUTCFullYear()
        ? db.liabilities.findMany({ select: { kind: true, ytdInterestPaidCents: true } })
        : Promise.resolve([]),
      loadTaxTags(userId, year, { client }),
      db.taxProfiles.findFirst({
        select: {
          payAsOf: true,
          payGrossYtdCents: true,
          payFederalYtdCents: true,
          payStateYtdCents: true,
          payRetirementYtdCents: true,
          payPretaxYtdCents: true,
          w4Step: true,
          w4AmountCents: true,
          w4ChangedOn: true,
          w4Year: true,
          keepRefundYear: true,
          homeOfficeSqFt: true,
          businessMiles: true,
          businessMilesYear: true,
          taxPayments: true,
        },
      }),
    ]);

  const rows = transactions.map((t) => ({ ...t, date: iso(t.date) }));
  const taxable = new Set(
    accounts.filter((a) => TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? "")).map((a) => a.id),
  );
  const cash = investmentCash
    .filter((c) => taxable.has(c.accountId))
    .map((c) => ({ date: iso(c.date), amountCents: c.amountCents, subtype: c.subtype }));
  const paychecks = rows.filter(
    (t) =>
      t.amountCents < 0 &&
      t.pfcDetailed !== null &&
      (INCOME_KINDS.w2.categories as readonly string[]).includes(t.pfcDetailed),
  );

  const assumptions: string[] = [];
  let pay: PayPicture;
  if (demo && paychecks.length > 0) {
    // The demo bank's stand-in for a payroll connection.
    pay = payFromStubs(
      demoPayroll.payStubs(
        paychecks.map((t) => ({
          date: t.date,
          amountCents: -t.amountCents,
          payer: (t.merchantName ?? t.description).trim(),
        })),
      ),
      year,
      today,
    );
    assumptions.push("Your pay and withholding come from the demo bank's sample pay stubs.");
  } else if (stored?.payAsOf && stored.payGrossYtdCents !== null) {
    pay = payFromYtd(
      {
        asOf: iso(stored.payAsOf),
        grossCents: stored.payGrossYtdCents,
        federalCents: stored.payFederalYtdCents ?? 0,
        stateCents: stored.payStateYtdCents ?? 0,
        retirementCents: stored.payRetirementYtdCents ?? 0,
        pretaxCents: stored.payPretaxYtdCents ?? 0,
      },
      year,
      today,
    );
    assumptions.push(
      `Your pay and withholding come from your pay stub as of ${pay.asOf}, projected at the same pace.`,
    );
  } else {
    pay = NO_PAY();
  }

  const elapsed = yearElapsed(year, today);
  // With paychecks but no pay stub: take-home pay stands in for wages, and withholding is
  // unknown.
  const takeHome = paychecks.reduce((s, t) => s - t.amountCents, 0);
  const withholdingKnown = pay.source !== "none" || takeHome === 0;
  if (!withholdingKnown) {
    assumptions.push(
      "I can see your paychecks but not your pay stubs, so I've used your take-home pay as your wages and can't tell what was withheld. Add your pay stub figures for a refund-or-owe estimate.",
    );
  }
  const wagesSoFar = pay.source === "none" ? takeHome : pay.soFar.wagesCents;
  const wagesProjected =
    pay.source === "none"
      ? elapsed > 0 && elapsed < 1
        ? Math.round(takeHome / elapsed)
        : takeHome
      : pay.projected.wagesCents;

  // Spec step 123: freelance income less business expenses (tagged, and miles driven), and
  // the home office for the year; estimated payments made from accounts Jane can't see.
  const miles = stored?.businessMilesYear === year ? (stored.businessMiles ?? 0) : 0;
  const businessSoFar = tags.totals.business.totalCents + mileageDeduction(miles);
  const otherSoFar = otherIncomeSoFar(rows, cash, year, businessSoFar);
  // Spec step 124: gains realised this year in taxable investment accounts.
  const gains = (await loadInvestmentTaxes(userId, year, { client, now })).realisedCents;
  const paced = {
    ...projectOther(otherSoFar, year, today),
    shortTermGainsCents: gains.shortTerm,
    longTermGainsCents: gains.longTerm,
  };
  const homeOffice =
    paced.selfEmploymentCents > 0
      ? Math.min(homeOfficeDeduction(stored?.homeOfficeSqFt ?? null), paced.selfEmploymentCents)
      : 0;
  const other = { ...paced, selfEmploymentCents: paced.selfEmploymentCents - homeOffice };
  const seen = taxPaymentsFor(rows, year);
  const typed = enteredTaxPayments(stored?.taxPayments, year);
  const payments = {
    federalCents: seen.federalCents + typed.federalCents,
    stateCents: seen.stateCents + typed.stateCents,
  };
  const loanInterest = (kind: string) => {
    const ytd = loans
      .filter((l) => l.kind === kind)
      .reduce((s, l) => s + (l.ytdInterestPaidCents ?? 0), 0);
    return elapsed > 0 && elapsed < 1 ? Math.round(ytd / elapsed) : ytd;
  };

  const filingStatus: FilingStatus = profile.filingStatus ?? "single";
  if (!profile.filingStatus) {
    assumptions.push("You haven't told me how you file, so I've estimated as single.");
  }
  const state = profile.state ?? view.state.value;
  if (state && view.state.status !== "yours") {
    assumptions.push(`I've assumed you file in ${stateName(state)}; check your tax profile.`);
  }
  if (view.dependants.status !== "yours") {
    assumptions.push("You haven't told me about dependants, so I've counted none.");
  }
  if (elapsed > 0 && elapsed < 1) {
    assumptions.push(`Income so far is projected to the end of ${year} at the same pace.`);
  }

  const input: EstimateInput = {
    year,
    filingStatus,
    childrenUnder17: profile.childrenUnder17,
    otherDependants: profile.otherDependants,
    state,
    income: {
      ...other,
      wagesCents: wagesProjected,
      socialSecurityWagesCents:
        pay.source === "none" ? wagesProjected : pay.projected.socialSecurityWagesCents,
    },
    studentLoanInterestCents: loanInterest("student"),
    mortgageInterestCents: loanInterest("mortgage"),
    charityCents: tags.totals.donation.totalCents,
    medicalCents: tags.totals.medical.totalCents,
    otherStateLocalTaxCents: 0,
    federalWithheldCents: pay.projected.federalWithheldCents,
    federalEstimatedPaidCents: payments.federalCents,
    stateWithheldCents: pay.projected.stateWithheldCents,
    stateEstimatedPaidCents: payments.stateCents,
  };
  const base = estimateTaxes(input);
  // Paydays: how often, and how many are left this year.
  const frequency = payFrequency(paychecks.map((t) => t.date));
  const lastPay =
    paychecks
      .map((t) => t.date)
      .sort()
      .at(-1) ?? null;
  const left = frequency && lastPay && elapsed < 1 ? paychecksLeft(lastPay, frequency.perYear) : 0;

  // Spec step 121: a W-4 change the person sent counts for the paychecks after it.
  let estimate = base;
  const w4 =
    stored?.w4Year === year && stored.w4Step && stored.w4AmountCents !== null && stored.w4ChangedOn
      ? {
          step: stored.w4Step as W4Step,
          amountCents: stored.w4AmountCents,
          changedOn: iso(stored.w4ChangedOn),
        }
      : null;
  if (w4 && frequency && withholdingKnown) {
    const per = perPaycheckEffect(w4.step, w4.amountCents, base.marginalRate, frequency.perYear);
    // Paychecks already paid since (the demo's sample stubs don't change) and those to come.
    const since = pay.source === "demo" ? paychecks.filter((t) => t.date > w4.changedOn).length : 0;
    const after =
      since +
      (lastPay && lastPay >= w4.changedOn ? left : paychecksLeft(w4.changedOn, frequency.perYear));
    const delta = per * Math.min(after, frequency.perYear);
    estimate = {
      ...base,
      paidCents: base.paidCents + delta,
      refundCents: base.refundCents + delta,
    };
    assumptions.push(`It includes the W-4 change you sent on ${w4.changedOn}.`);
  }
  const lastYearRefundCents = rows
    .filter(
      (t) =>
        t.pfcDetailed === "INCOME_TAX_REFUND" &&
        t.amountCents < 0 &&
        t.date.startsWith(String(year)) &&
        /\b(?:IRS|TREAS 310|US TREASURY|U\.S\. TREASURY)\b/i.test(
          `${t.description} ${t.merchantName ?? ""}`,
        ),
    )
    .reduce((s, t) => s - t.amountCents, 0);

  const otherSoFarCents = Object.entries(otherSoFar)
    .filter(([key]) => key !== "qualifiedDividendsCents")
    .reduce((sum, [, cents]) => sum + cents, 0);
  return {
    year,
    elapsed,
    incomeSoFarCents: wagesSoFar + otherSoFarCents,
    estimate,
    pay,
    withholdingKnown,
    assumptions,
    unconfirmed: profile.unconfirmed,
    input,
    paychecks: {
      count: paychecks.filter((t) => t.date <= today).length,
      perYear: frequency?.perYear ?? null,
      left,
      last: lastPay,
      withheldPerPaycheckCents:
        pay.source !== "none" && paychecks.length > 0
          ? Math.round(
              pay.soFar.federalWithheldCents /
                Math.max(1, paychecks.filter((t) => t.date <= today).length),
            )
          : 0,
    },
    w4,
    keepRefundYear: stored?.keepRefundYear ?? null,
    lastYearRefundCents: lastYearRefundCents > 0 ? lastYearRefundCents : null,
  };
}

export const filingLabel = (status: FilingStatus) => FILING_STATUSES[status];

// Spec step 123: estimated tax payments the person told Jane about, for the tax year (Feb 1
// to Jan 31 of the next year, like the ones seen in transactions).
export type EnteredTaxPayment = { date: string; cents: number; to: "federal" | "state" };

export function parseTaxPayments(value: unknown): EnteredTaxPayment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is EnteredTaxPayment =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as EnteredTaxPayment).date === "string" &&
      Number.isInteger((p as EnteredTaxPayment).cents) &&
      ((p as EnteredTaxPayment).to === "federal" || (p as EnteredTaxPayment).to === "state"),
  );
}

export function enteredTaxPayments(value: unknown, year: number) {
  const inYear = parseTaxPayments(value).filter(
    (p) => p.date >= `${year}-02-01` && p.date <= `${year + 1}-01-31`,
  );
  return {
    federalCents: inYear.filter((p) => p.to === "federal").reduce((s, p) => s + p.cents, 0),
    stateCents: inYear.filter((p) => p.to === "state").reduce((s, p) => s + p.cents, 0),
  };
}
