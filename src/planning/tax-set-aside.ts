import { TAX_SET_ASIDE as C } from "@/config/tax-set-aside";
import { dayLabel } from "@/lib/day-label";
import { plural } from "@/lib/plural";
import { NO_INCOME, estimateTaxes, type EstimateInput, type TaxEstimate } from "./tax-estimate";

// The tax left to cover on the income so far, line by line: income, deductions, the taxable amount,
// the tax, what's withheld or paid, what's left. Pure, and arithmetic on the person's own numbers:
// every line adds up to the next total exactly, in cents.
//
// Real accounts get this as a fact, "not yet withheld or paid". "Set aside" is telling someone what
// to do with their money (src/lib/guardrails.ts), so that wording is for demo advice only.

// Where a line's figure comes from: in their accounts, worked out, supposed, or their own word.
export type LineSource = "seen" | "estimated" | "assumed" | "told";

export const SOURCE_WORDS: Readonly<Record<LineSource, string>> = {
  seen: "Seen",
  estimated: "Estimated",
  assumed: "Assumed",
  told: "You told Jane",
};

export type TaxLine = {
  key: string;
  label: string;
  sign: "" | "+" | "−" | "=";
  // Null: not known, which isn't $0.
  cents: number | null;
  source: LineSource;
  from: string;
};

export type SetAsideInput = {
  year: number;
  today: string;
  // How much of the year the income covers, 0 to 1 (yearCovered).
  elapsed: number;
  advice: boolean;
  estimate: TaxEstimate;
  input: EstimateInput;
  withholdingKnown: boolean;
  // Income so far, net of business costs, and the costs themselves.
  incomeSoFarCents: number;
  businessCostsCents: number;
  businessCostsYearCents: number;
  homeOfficeCents: number;
  profitAssumed: boolean;
  federalWithheldCents: number;
  stateWithheldCents: number;
  // "demo": sample stubs. "pay_stub": the person's stub. "told": a figure they gave. "none".
  withheldFrom: "demo" | "pay_stub" | "told" | "none";
  // The pay stub was old enough that withholding is projected to today, rather than read.
  withheldProjected: boolean;
  seenPaidCents: number;
  toldPaidCents: number;
  keptApart: { seenCents: number; seenIn: string[]; toldCents: number | null };
  incomeMonths: number;
  firstSeen: string | null;
  filingStatusKnown: boolean;
  corrected: { income: boolean; wages: boolean; selfEmployed: boolean };
};

type SetAsideStatus = "needed" | "covered" | "unknown" | "no_income";

export type TaxSetAside = {
  year: number;
  status: SetAsideStatus;
  advice: boolean;
  lines: TaxLine[];
  // The share of the year counted, 0 to 1.
  share: number;
  taxForYearCents: number;
  taxSoFarCents: number;
  paidSoFarCents: number;
  // Tax so far less what's withheld or paid; null when withholding is unknown and nothing else shows.
  notYetPaidCents: number | null;
  keptApartCents: number;
  // What Safe to spend holds back: 0 unless the status is "needed".
  holdCents: number;
  withholdingKnown: boolean;
  // Said out loud beside the figure: what Jane doesn't know.
  unknowns: string[];
  confidence: { percent: number; reason: string };
};

// The words for the last line and for the card, by who may read what.
export const leftLabel = (advice: boolean) =>
  advice ? "Left to set aside" : "Not yet withheld or paid";

// Said plainly when nothing is kept apart, in words that don't tell them to do anything.
export const NOTHING_KEPT_APART = "Jane can't see any money kept apart for this.";

function otherLinesOf(e: TaxEstimate) {
  const credits =
    e.credits.childTaxCreditCents +
    e.credits.otherDependantCreditCents +
    e.credits.additionalChildTaxCreditCents +
    e.credits.earnedIncomeCreditCents;
  // The engine's total also takes off credits it works out elsewhere (education, care).
  const otherTaxes = e.additionalMedicareCents + e.netInvestmentIncomeTaxCents + e.amtCents;
  const otherCredits =
    e.incomeTaxCents + e.selfEmploymentTaxCents + otherTaxes - credits - e.totalTaxCents;
  return { credits: credits + otherCredits, otherTaxes };
}

const taxOnWagesOnly = (input: EstimateInput) => {
  const e = estimateTaxes({
    ...input,
    income: {
      ...NO_INCOME,
      wagesCents: input.income.wagesCents,
      socialSecurityWagesCents: input.income.socialSecurityWagesCents,
    },
  });
  return Math.max(0, e.totalTaxCents + (e.state?.taxCents ?? 0));
};

function incomeLines(x: SetAsideInput): TaxLine[] {
  const e = x.estimate;
  const seen = x.incomeSoFarCents + x.businessCostsCents;
  const year = e.totalIncomeCents + x.businessCostsYearCents + x.homeOfficeCents;
  const rest = year - seen;
  return [
    {
      key: "income_seen",
      label: "Income Jane saw so far",
      sign: "",
      cents: seen,
      source: x.corrected.wages || x.corrected.selfEmployed ? "told" : "seen",
      from: x.corrected.income
        ? "Deposits in your accounts, with what you pointed out."
        : "Deposits in your accounts and any pay stub figures you gave.",
    },
    ...(rest !== 0
      ? [
          {
            key: "income_rest",
            label:
              rest > 0 && x.elapsed < 1
                ? "Rest of the year at this pace"
                : "Other items in the estimate",
            sign: rest > 0 ? ("+" as const) : ("−" as const),
            cents: Math.abs(rest),
            source: "estimated" as const,
            from:
              rest > 0 && x.elapsed < 1
                ? `The income so far, carried to the end of ${x.year}, with any gains from sales.`
                : "Rental costs, gains from sales and the taxable part of Social Security.",
          },
        ]
      : []),
    {
      key: "income_year",
      label: `Income for ${x.year}`,
      sign: "=",
      cents: year,
      source: "estimated",
      from: "The two lines above.",
    },
  ];
}

function deductionLines(x: SetAsideInput): TaxLine[] {
  const e = x.estimate;
  const minus = (
    key: string,
    label: string,
    cents: number,
    source: LineSource,
    from: string,
  ): TaxLine[] => (cents > 0 ? [{ key, label, sign: "−", cents, source, from }] : []);
  const itemized = e.deduction.kind === "itemized";
  const lines = [
    ...minus(
      "business_costs",
      "Costs of your work",
      x.businessCostsYearCents,
      "seen",
      "What you tagged as business or told Jane, carried to the year's end. You might be able to deduct these; check with a tax professional.",
    ),
    ...minus(
      "home_office",
      "Home office",
      x.homeOfficeCents,
      "told",
      "From the size you gave. You might be able to deduct it; check with a tax professional.",
    ),
    ...minus(
      "half_se",
      "Half of self-employment tax",
      e.adjustments.halfSelfEmploymentTaxCents,
      "estimated",
      "Worked out from your self-employment income.",
    ),
    ...minus(
      "student_loan",
      "Student loan interest",
      e.adjustments.studentLoanInterestCents,
      "seen",
      "Reported by your lender. You might be able to deduct it; check with a tax professional.",
    ),
    ...minus(
      "told_deductions",
      "Deductions you pointed out",
      x.input.otherAdjustmentsCents ?? 0,
      "told",
      "Your own figures, counted as you gave them. Check with a tax professional whether they apply.",
    ),
    ...minus(
      "deduction",
      itemized ? "Itemized deductions" : "Standard deduction",
      itemized ? e.deduction.itemizedCents : e.deduction.standardCents,
      itemized ? "seen" : "assumed",
      itemized
        ? "Mortgage interest, state and local tax, gifts and medical costs in your accounts. Check with a tax professional."
        : "The standard amount for how you file. Your own costs might come to more; check with a tax professional.",
    ),
    ...minus(
      "charity",
      "Cash gifts to charity",
      e.deduction.nonItemizerCharityCents,
      "seen",
      "Gifts you tagged, up to the limit. You might be able to deduct them; check with a tax professional.",
    ),
    ...minus(
      "qbi",
      "Qualified business income",
      e.qbiCents,
      "estimated",
      "A share of your self-employment income. You might be able to deduct it; check with a tax professional.",
    ),
  ];
  const year = e.totalIncomeCents + x.businessCostsYearCents + x.homeOfficeCents;
  const after = year - lines.reduce((s, l) => s + (l.cents ?? 0), 0);
  const unused = e.taxableCents - after;
  return [
    ...lines,
    ...(unused !== 0
      ? [
          {
            key: "unused",
            label: "Deductions above your income",
            sign: unused > 0 ? ("+" as const) : ("−" as const),
            cents: Math.abs(unused),
            source: "estimated" as const,
            from: "Income can't go below nothing, so what's over isn't counted.",
          },
        ]
      : []),
    {
      key: "taxable",
      label: "Taxable amount",
      sign: "=",
      cents: e.taxableCents,
      source: "estimated",
      from: "Income for the year, less the lines above.",
    },
  ];
}

function taxLines(x: SetAsideInput, stateKnown: boolean, total: number): TaxLine[] {
  const e = x.estimate;
  const { credits, otherTaxes } = otherLinesOf(e);
  const line = (key: string, label: string, sign: "+" | "−", cents: number, from: string) =>
    cents !== 0
      ? [{ key, label, sign, cents, source: "estimated" as const, from } satisfies TaxLine]
      : [];
  return [
    {
      key: "income_tax",
      label: "Income tax on that",
      sign: "",
      cents: e.incomeTaxCents,
      source: x.filingStatusKnown ? "estimated" : "assumed",
      from: x.filingStatusKnown
        ? "This year's federal brackets, for how you file."
        : "This year's federal brackets. You haven't said how you file, so Jane assumed it.",
    },
    ...line(
      "se_tax",
      "Self-employment tax",
      "+",
      e.selfEmploymentTaxCents,
      "Social Security and Medicare on your self-employment income.",
    ),
    ...line(
      "other_taxes",
      "Other federal taxes",
      "+",
      otherTaxes,
      "Additional Medicare, net investment income and alternative minimum tax.",
    ),
    ...line("credits", "Credits", "−", credits, "Credits for your dependants and your income."),
    stateKnown
      ? {
          key: "state",
          label: "State and local tax",
          sign: "+",
          cents: e.state?.taxCents ?? 0,
          source: e.state?.rough ? "assumed" : "estimated",
          from: e.state?.rough
            ? "A rough rate for your state."
            : "Your state's rates for the year.",
        }
      : {
          key: "state",
          label: "State tax",
          sign: "+",
          cents: null,
          source: "assumed",
          from: "Jane doesn't know your state, so this isn't counted and the total could be higher.",
        },
    {
      key: "tax_year",
      label: `Tax for ${x.year}`,
      sign: "=",
      cents: total,
      source: "estimated",
      from: "The lines above.",
    },
  ];
}

function confidenceOf(
  x: SetAsideInput,
  stateKnown: boolean,
  partYear: boolean,
): { percent: number; unknowns: string[]; reason: string } {
  const monthsWord = plural(x.incomeMonths, "month");
  const caps: { percent: number; said: string | null }[] = [{ percent: C.topPercent, said: null }];
  const monthCap = C.monthsCaps.find((m) => x.incomeMonths < m.under);
  if (monthCap)
    caps.push({
      percent: monthCap.percent,
      said: `Only ${monthsWord} of income ${x.incomeMonths === 1 ? "is" : "are"} in your accounts, so the year's pace is a rough guess.`,
    });
  if (partYear)
    caps.push({
      percent: C.partYearPercent,
      said: `Your accounts start on ${x.firstSeen ? dayLabel(x.firstSeen, { year: true }) : "a later date"}, so income before that isn't counted.`,
    });
  if (!x.withholdingKnown)
    caps.push({
      percent: C.withholdingUnknownPercent,
      said: "Jane can see your paychecks but not what's withheld from them. It assumed that covers the tax on your wages, and it might not.",
    });
  if (!x.filingStatusKnown)
    caps.push({
      percent: C.filingStatusAssumedPercent,
      said: "You haven't said how you file, so Jane assumed it.",
    });
  if (!stateKnown)
    caps.push({
      percent: C.stateUnknownPercent,
      said: "Jane doesn't know your state, so state tax isn't counted.",
    });
  if (x.profitAssumed)
    caps.push({
      percent: C.businessCostsUnknownPercent,
      said: "No business costs are tagged, so Jane assumed a share of your sales is profit.",
    });
  const percent = Math.min(...caps.map((c) => c.percent));
  const unknowns = caps.flatMap((c) => (c.said ? [c.said] : []));
  return {
    percent,
    unknowns,
    // The card adds its own full stop.
    reason:
      unknowns[0]?.replace(/\.$/, "") ??
      `${monthsWord} of income in your accounts, with what's withheld and paid known`,
  };
}

export function workOutSetAside(x: SetAsideInput): TaxSetAside {
  const e = x.estimate;
  const stateKnown = x.input.state !== null;
  const share = Math.min(1, Math.max(0, x.elapsed));
  const partYear = x.firstSeen !== null && x.firstSeen > `${x.year}-${C.partYearAfter}`;
  const total = e.totalTaxCents + (e.state?.taxCents ?? 0);
  const { percent, unknowns, reason } = confidenceOf(x, stateKnown, partYear);
  const taxSoFar = Math.round(total * share);

  const lines: TaxLine[] = [
    ...incomeLines(x),
    ...deductionLines(x),
    ...taxLines(x, stateKnown, total),
  ];
  if (share < 1)
    lines.push(
      {
        key: "tax_later",
        label: "Tax on income still to come",
        sign: "−",
        cents: total - taxSoFar,
        source: "estimated",
        from: `${Math.round(share * 100)}% of the year is counted so far; the rest isn't earned yet.`,
      },
      {
        key: "tax_so_far",
        label: "Tax on your income so far",
        sign: "=",
        cents: taxSoFar,
        source: "estimated",
        from: "The tax for the year, for the part of it counted so far.",
      },
    );

  // With paychecks and no stubs, withholding is unknown: Jane assumes it covers the tax on the
  // wages, so what's left is the tax on everything else. Never $0 by default.
  const wagesCovered = x.withholdingKnown
    ? 0
    : Math.min(Math.max(0, taxSoFar), Math.round(taxOnWagesOnly(x.input) * share));
  const withheld = x.federalWithheldCents + x.stateWithheldCents;
  const hasPay = withheld > 0 || x.withheldFrom !== "none";
  if (!x.withholdingKnown)
    lines.push({
      key: "withheld",
      label: "Withheld from your pay",
      sign: "−",
      cents: wagesCovered,
      source: "assumed",
      from: "Jane can't see what's withheld. It assumed it covers the tax on your wages; a pay stub or your own figure makes this exact.",
    });
  else if (hasPay)
    lines.push({
      key: "withheld",
      label: "Withheld from your pay",
      sign: "−",
      cents: withheld,
      source: x.withheldFrom === "told" ? "told" : x.withheldProjected ? "estimated" : "seen",
      from:
        x.withheldFrom === "told"
          ? "The figure you gave."
          : x.withheldFrom === "demo"
            ? "The demo bank's sample pay stubs."
            : x.withheldProjected
              ? "Your pay stub, carried to today at the same pace."
              : "Your pay stub.",
    });
  else
    lines.push({
      key: "withheld",
      label: "Withheld from your pay",
      sign: "−",
      cents: 0,
      source: "seen",
      from: "No paychecks in your accounts, so nothing is withheld.",
    });
  if (x.seenPaidCents > 0)
    lines.push({
      key: "paid_seen",
      label: "Tax payments in your accounts",
      sign: "−",
      cents: x.seenPaidCents,
      source: "seen",
      from: "Payments to the IRS and your state in your transactions.",
    });
  if (x.toldPaidCents > 0)
    lines.push({
      key: "paid_told",
      label: "Tax payments you told Jane about",
      sign: "−",
      cents: x.toldPaidCents,
      source: "told",
      from: "Payments from accounts Jane can't see.",
    });
  const paid = (x.withholdingKnown ? withheld : wagesCovered) + x.seenPaidCents + x.toldPaidCents;
  const short = taxSoFar - paid;
  const left = Math.max(0, short);
  if (short < 0)
    lines.push({
      key: "ahead",
      label: "More than the tax so far",
      sign: "+",
      cents: -short,
      source: "estimated",
      from: "More is withheld or paid than the tax on your income so far.",
    });
  lines.push({
    key: "left",
    label: leftLabel(x.advice),
    sign: "=",
    cents: left,
    source: "estimated",
    from: "An estimate: the tax so far, less what's withheld and paid.",
  });

  const keptWanted = x.keptApart.seenCents + (x.keptApart.toldCents ?? 0);
  const kept = Math.min(left, keptWanted);
  if (keptWanted > 0) {
    lines.push(
      {
        key: "kept_apart",
        label: "Already kept apart",
        sign: "−",
        cents: kept,
        source: x.keptApart.toldCents ? "told" : "seen",
        from: x.keptApart.seenIn.length
          ? `In ${x.keptApart.seenIn.join(" and ")}.`
          : "The figure you gave.",
      },
      {
        key: "held",
        label: "Held back from Safe to spend",
        sign: "=",
        cents: left - kept,
        source: "estimated",
        from: "What's left after the money you already keep apart.",
      },
    );
  }
  const hold = left - kept;
  const noIncome = x.incomeSoFarCents + x.businessCostsCents === 0 && e.totalIncomeCents === 0;
  const status: SetAsideStatus = noIncome
    ? "no_income"
    : hold >= C.minLeftCents
      ? "needed"
      : !x.withholdingKnown
        ? "unknown"
        : "covered";
  return {
    year: x.year,
    status,
    advice: x.advice,
    lines,
    share,
    taxForYearCents: total,
    taxSoFarCents: taxSoFar,
    paidSoFarCents: paid,
    notYetPaidCents: status === "unknown" ? null : left,
    keptApartCents: kept,
    holdCents: status === "needed" ? hold : 0,
    withholdingKnown: x.withholdingKnown,
    unknowns,
    confidence: { percent, reason },
  };
}
