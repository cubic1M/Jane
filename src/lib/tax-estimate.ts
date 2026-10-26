import { dependantsWords } from "@/planning/tax-profile";
import { DETECTOR_RATES } from "@/config/detectors";
import {
  IRA_DISTRIBUTION,
  RETIREMENT_DEPOSIT_WORDS,
  SOCIAL_SECURITY_PAYEE,
} from "@/config/retirement-taxes";
import {
  FILING_STATUSES,
  BUSINESS_SALES_CATEGORIES,
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
import { loadEquityIncome } from "@/lib/equity-income";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { rentalDepreciation, rentalNet } from "@/planning/side-income";
import { formatCents } from "@/lib/money";
import { loadResidency, residencyFor, type ResidencyView } from "@/lib/tax-states";
import { LOCAL_TAXES } from "@/config/tax-states";
import {
  NO_PAY,
  payFrequency,
  paychecksLeft,
  businessSalesSoFar,
  otherIncomeSoFar,
  payFromStubs,
  payFromYtd,
  projectOther,
  taxPaymentsFor,
  propertyTaxFor,
  yearElapsed,
  type PayPicture,
} from "@/planning/tax-income";
import { defaultTaxYear } from "@/planning/tax-pack";
import { dayLabel } from "@/lib/day-label";
import { guessFilingStatus, stateName, type ProfileField } from "@/planning/tax-profile";
import { isoDay as iso } from "@/lib/dates";

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
  // False when Jane can see paychecks but not what was withheld: it can say the tax, not
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
  // Spec step 165: where the person lived and worked in the year.
  residency: ResidencyView;
  keepRefundYear: number | null;
  lastYearRefundCents: number | null;
};

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
  const jointAccounts = await db.accounts.count({
    where: { name: { contains: "joint", mode: "insensitive" } },
  });
  const [
    { view, profile },
    demo,
    transactions,
    accounts,
    investmentCash,
    loans,
    tags,
    stored,
    residency,
  ] = await Promise.all([
    loadWorkingProfile(userId, { client, now }),
    hasDemoBank(userId, { client }),
    db.transactions.findMany({
      where: {
        pending: false,
        OR: [
          { pfcDetailed: { in: incomeCategories } },
          // A shop's card sales, often other income or a deposit (businessSalesSoFar).
          { amountCents: { lt: 0 }, pfcDetailed: { in: [...BUSINESS_SALES_CATEGORIES] } },
        ],
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 1, 1)) },
      },
      select: {
        date: true,
        amountCents: true,
        pfcDetailed: true,
        description: true,
        merchantName: true,
      },
      // In a fixed order: the last paycheck decides how many are left in the year.
      orderBy: [{ date: "asc" }, { amountCents: "asc" }, { id: "asc" }],
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
        rentalPriceCents: true,
        rentalPlacedOn: true,
        sideIncomeKind: true,
      },
    }),
    loadResidency(userId, year, { client }),
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
      `Your pay and withholding come from your pay stub as of ${dayLabel(pay.asOf ?? "", { year: true })}, projected at the same pace.`,
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
  // A shop's card sales (taxes QA): profit is sales less the business expenses tagged; with
  // none tagged, the share of sales the detectors assume, said as an assumption.
  const sales = businessSalesSoFar(rows, year);
  if (sales > 0) {
    const profit =
      businessSoFar > 0 ? sales : Math.round(sales * DETECTOR_RATES.tax.businessProfitShare);
    otherSoFar.selfEmploymentCents += profit;
    if (businessSoFar === 0) {
      assumptions.push(
        `Your card sales so far (${formatCents(sales)}) are business income. I've counted ${Math.round(DETECTOR_RATES.tax.businessProfitShare * 100)}% of them as profit until you tag your business expenses (rent, payroll, supplies), which makes it exact.`,
      );
    }
  }
  // Spec step 124: gains realised this year in taxable investment accounts.
  const gains = (await loadInvestmentTaxes(userId, year, { client, now })).realisedCents;
  // Spec step 219: crypto sold by lot, ESPP sales and ISO exercises.
  const equity = await loadEquityIncome(userId, year, { client, now });
  const paced = {
    ...projectOther(otherSoFar, year, today),
    shortTermGainsCents: gains.shortTerm + equity.shortTermGainsCents,
    longTermGainsCents: gains.longTerm + equity.longTermGainsCents,
  };
  // Spec step 173: a rental's net (rent less tagged expenses less depreciation, with the
  // passive loss allowance), and a hobby's income without its expenses.
  const sideStored = stored;
  const rentalExpenses =
    elapsed > 0 && elapsed < 1
      ? Math.round(tags.totals.rental.totalCents / elapsed)
      : tags.totals.rental.totalCents;
  const depreciation =
    sideStored?.rentalPriceCents && sideStored.rentalPlacedOn
      ? rentalDepreciation({
          year,
          priceCents: sideStored.rentalPriceCents,
          placedOn: iso(sideStored.rentalPlacedOn),
        }).cents
      : 0;
  if (paced.rentalCents > 0 || rentalExpenses > 0 || depreciation > 0) {
    const net = rentalNet({
      rentCents: paced.rentalCents,
      expensesCents: rentalExpenses,
      depreciationCents: depreciation,
      otherIncomeCents:
        wagesProjected + paced.selfEmploymentCents + paced.interestCents + paced.dividendsCents,
    });
    paced.rentalCents = net.countedCents;
    if (net.expensesCents + net.depreciationCents > 0) {
      assumptions.push(
        `Your rental: rent less expenses and depreciation comes to ${net.netCents < 0 ? "a loss of " : ""}${formatCents(Math.abs(net.netCents))}${net.suspendedCents > 0 ? `; ${formatCents(net.suspendedCents)} of the loss carries forward` : ""}.`,
      );
    }
  }
  const hobby =
    sideStored?.sideIncomeKind === "hobby" && paced.selfEmploymentCents + businessSoFar > 0;
  const hobbyIncome = hobby
    ? projectOther(
        { ...otherSoFar, selfEmploymentCents: otherSoFar.selfEmploymentCents + businessSoFar },
        year,
        today,
      ).selfEmploymentCents
    : 0;
  if (hobby) {
    paced.selfEmploymentCents = 0;
    assumptions.push(
      "You said your side income is a hobby, so it's taxed with no expenses and no self-employment tax.",
    );
  }
  const homeOffice =
    paced.selfEmploymentCents > 0
      ? Math.min(homeOfficeDeduction(stored?.homeOfficeSqFt ?? null), paced.selfEmploymentCents)
      : 0;
  // Taxes QA: Social Security and traditional IRA withdrawals, as they land in the accounts,
  // projected to the year's end; only Social Security's taxable part counts (the engine).
  const retirementRows = await db.transactions.findMany({
    where: {
      pending: false,
      amountCents: { lt: 0 },
      date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      OR: RETIREMENT_DEPOSIT_WORDS.map((w) => ({
        description: { contains: w, mode: "insensitive" as const },
      })),
    },
    select: { amountCents: true, description: true },
  });
  const paceYear = (cents: number) =>
    elapsed > 0 && elapsed < 1 ? Math.round(cents / elapsed) : cents;
  const benefits = paceYear(
    retirementRows
      .filter((t) => SOCIAL_SECURITY_PAYEE.test(t.description))
      .reduce((s, t) => s - t.amountCents, 0),
  );
  const iraDraws = paceYear(
    retirementRows
      .filter((t) => IRA_DISTRIBUTION.test(t.description))
      .reduce((s, t) => s - t.amountCents, 0),
  );
  paced.retirementCents += iraDraws;
  if (benefits > 0) {
    assumptions.push(
      `Your Social Security comes to about ${formatCents(benefits)} this year; only the part your other income makes taxable is counted.`,
    );
  }
  if (iraDraws > 0) {
    assumptions.push(
      `Withdrawals from your IRA (about ${formatCents(iraDraws)} this year) are taxed as income.`,
    );
  }
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

  // Taxes QA: a couple's signs (a joint account, two employers) mean married filing jointly.
  const guessed = profile.filingStatus
    ? null
    : guessFilingStatus({
        jointAccounts,
        payrollNames: paychecks.map((t) => t.description),
      });
  const filingStatus: FilingStatus = profile.filingStatus ?? guessed?.status ?? "single";
  if (!profile.filingStatus) {
    assumptions.push(
      guessed
        ? `You haven't told me how you file. I see ${guessed.why}, so I've estimated as married filing jointly; tell me if that's wrong.`
        : "You haven't told me how you file, so I've estimated as single.",
    );
  }
  const state = profile.state ?? view.state.value;
  if (state && view.state.status !== "yours") {
    assumptions.push(`I've assumed you file in ${stateName(state)}; check your tax profile.`);
  }
  for (const m of residency.inUse) {
    assumptions.push(
      `${residency.usingSpotted ? "I've assumed you moved" : "You moved"} from ${stateName(m.from)} to ${stateName(m.to)} on ${dayLabel(m.date, { year: true })}: wages count where you lived on each payday, other income by the days you lived in each state.`,
    );
  }
  if (residency.workState && residency.workState !== state) {
    assumptions.push(`You work for an employer in ${stateName(residency.workState)}.`);
  }
  const local = residency.locality ? LOCAL_TAXES[residency.locality] : undefined;
  if (local) assumptions.push(`You live in ${local.label}, which has its own income tax.`);
  if (view.dependants.status === "found") {
    const counted = profile.childrenUnder17 + profile.otherDependants > 0;
    const found = `the ${dependantsWords(view.dependants.childrenUnder17 ?? 0, view.dependants.otherDependants ?? 0)} in your household`;
    assumptions.push(
      counted
        ? `I've counted ${found}; check them on your tax profile.`
        : `I've counted no dependants yet: say yes to ${found} on your tax profile to count them.`,
    );
  } else if (view.dependants.status !== "yours") {
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
    residency: residencyFor(
      residency,
      paychecks.map((t) => ({ date: t.date, cents: -t.amountCents })),
    ),
    income: {
      ...other,
      otherCents: hobbyIncome,
      socialSecurityBenefitsCents: benefits,
      wagesCents: wagesProjected + equity.ordinaryCents,
      socialSecurityWagesCents:
        pay.source === "none" ? wagesProjected : pay.projected.socialSecurityWagesCents,
    },
    studentLoanInterestCents: loanInterest("student"),
    amtPreferenceCents: equity.amtPreferenceCents,
    mortgageInterestCents: loanInterest("mortgage"),
    charityCents: tags.totals.donation.totalCents,
    medicalCents: tags.totals.medical.totalCents,
    // Spec step 170: property tax paid this year.
    otherStateLocalTaxCents: propertyTaxFor(rows, year),
    federalWithheldCents: pay.projected.federalWithheldCents,
    federalEstimatedPaidCents: payments.federalCents,
    stateWithheldCents: pay.projected.stateWithheldCents,
    stateEstimatedPaidCents: payments.stateCents,
  };
  const base = estimateTaxes(input);
  // Spec step 219: crypto, ESPP and ISO income, said plainly.
  if (equity.ordinaryCents > 0) {
    assumptions.push(
      `I've added ${formatCents(equity.ordinaryCents)} of ESPP and option sale income to your wages. If your W-2 already includes it, your estimate is that much too high.`,
    );
  }
  if (base.amtCents > 0) {
    assumptions.push(
      `Options you exercised and still hold count toward the alternative minimum tax: about ${formatCents(base.amtCents)}.`,
    );
  }
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
    assumptions.push(
      `It includes the W-4 change you sent on ${dayLabel(w4.changedOn, { year: true })}.`,
    );
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
    residency,
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
