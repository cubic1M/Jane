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
import { estimateTaxes, type TaxEstimate } from "@/planning/tax-estimate";
import {
  NO_PAY,
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
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadTaxEstimate(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxEstimateView> {
  const today = iso(now);
  const year = defaultTaxYear(today);
  const db = scopedFor(userId, client);
  const incomeCategories = [
    ...Object.values(INCOME_KINDS).flatMap((k) => [...k.categories]),
    "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
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

  const otherSoFar = otherIncomeSoFar(rows, cash, year);
  const other = projectOther(otherSoFar, year, today);
  const payments = taxPaymentsFor(rows, year);
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

  const estimate = estimateTaxes({
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
  });
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
  };
}

export const filingLabel = (status: FilingStatus) => FILING_STATUSES[status];
