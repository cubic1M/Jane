import { DETECTOR_RATES } from "@/config/detectors";
import { SS_TAX_MIN_CENTS } from "@/config/retirement-taxes";
import { W4V_RATES } from "@/config/student-taxes";
import { formatCents } from "@/lib/money";
import { readRetirementTaxes } from "@/planning/retirement-taxes-read";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { evidence, factEvidence, headlineOf, weakest } from "./helpers";
import { stockVestGap } from "./taxes";

// Fact versions of advice-only cards (suggest-taxes phase 2, 11-18). The advice card says what to do
// and is for demo advice only (ADVICE_TOPICS); a real account had nothing. These say what Jane sees,
// the rule and its figure, what the arithmetic gives for them, and the form that is theirs to use:
// no move. Each fires only for a real account (ctx.advice === false), so a demo person sees the
// advice card and never both. Pure.

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (rates: readonly number[]) =>
  `${rates.slice(0, -1).map(pct).join(", ")} or ${pct(rates.at(-1)!)}`;

// Beside social_security_tax: the part of Social Security that is income, and that nothing withholds
// from it without a form.
const socialSecurityTaxed: Detector = {
  capability: "taxes",
  topic: "social_security_taxed",
  covers: ["tax_retirement"],
  needs: ["income_pattern", "household"],
  detect({ profile, data, advice }): Suggestion | null {
    if (advice !== false) return null;
    const r = readRetirementTaxes(profile, data);
    if (r.ssDeposits < 3 || r.ss.taxableCents <= 0) return null;
    const tax = Math.round(r.ss.taxableCents * r.bracket);
    if (tax < SS_TAX_MIN_CENTS) return null;
    return suggestion("taxes", "social_security_taxed", {
      title: `About ${formatCents(r.ss.taxableCents)} of your Social Security is income for federal tax`,
      headline: headlineOf("Note Social Security's tax", tax, "risk"),
      short: `${formatCents(r.ss.taxableCents)} of your ${formatCents(r.ssBenefitsCents)} Social Security counts in your income.`,
      worthCents: tax,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, r.ssDeposits, "Social Security deposits"),
        { percent: 55, reason: "I can't see whether tax is already withheld from it" },
      ]),
      urgency: "later",
      why: `Your Social Security is ${formatCents(r.ssBenefitsCents)} a year and your other income about ${formatCents(r.otherIncomeCents)}, so about ${formatCents(r.ss.taxableCents)} of it goes into federal income (up to 85% of it once income passes the IRS's base amounts): about ${formatCents(tax)} of tax at your ${pct(r.bracket)} bracket. Social Security withholds federal tax only when a Form W-4V is on file, at ${list(W4V_RATES)}; otherwise it's due with the return.`,
      action: { label: "See the numbers", href: "/taxes" },
    });
  },
};

// Beside concentration: company stock's share of what they invest, in dollars.
const companyStockShare: Detector = {
  capability: "investing",
  topic: "company_stock_share",
  covers: ["company_stock"],
  needs: ["has_stock_plan"],
  detect({ profile, data, advice }): Suggestion | null {
    if (advice !== false) return null;
    const plan = profile.facts.has_stock_plan;
    if (plan.value !== true) return null;
    const invested = data.accounts
      .filter((a) => a.type === "investment")
      .reduce((s, a) => s + a.balanceCents, 0);
    const stock = data.accounts
      .filter((a) => a.subtype === "stock plan")
      .reduce((s, a) => s + a.balanceCents, 0);
    const R = DETECTOR_RATES;
    if (invested === 0 || stock / invested < R.concentrationShare) return null;
    const fall = Math.round(stock * R.concentrationDropShare);
    const share = Math.round((stock / invested) * 100);
    return suggestion("investing", "company_stock_share", {
      title: `Company stock is ${share}% of what you invest`,
      headline: headlineOf("Note your company stock's share", fall, "risk"),
      short: `Your company stock is ${formatCents(stock)}, ${share}% of your ${formatCents(invested)} invested.`,
      worthCents: fall,
      worthKind: "risk",
      confidence: factEvidence(plan),
      urgency: "later",
      why: `Your company stock is ${formatCents(stock)}, ${share}% of the ${formatCents(invested)} in your investment accounts. A ${pct(R.concentrationDropShare)} fall in that one stock would be ${formatCents(fall)}, and your pay comes from the same company.`,
      action: { label: "See your holdings", href: "/investments" },
    });
  },
};

// Beside withholding_gap: what a stock vest's flat withholding leaves at filing.
const stockVestTax: Detector = {
  capability: "taxes",
  topic: "stock_vest_tax",
  covers: ["tax_equity", "tax_withholding"],
  needs: ["has_stock_plan", "monthly_income", "household"],
  detect(ctx): Suggestion | null {
    if (ctx.advice !== false) return null;
    const gap = stockVestGap(ctx);
    if (!gap) return null;
    const { profile } = ctx;
    const { plan, income, stock, vested, rate, short, assumed } = gap;
    const flat = DETECTOR_RATES.tax.rsuFlatWithholding;
    return suggestion("taxes", "stock_vest_tax", {
      title: `Flat withholding on your stock vests leaves about ${formatCents(short)} to pay at filing`,
      headline: headlineOf("Check tax on your stock vests", short, "risk"),
      short: `${assumed ? "About " : ""}${formatCents(vested)} vesting, withheld at ${pct(flat)} against your ${pct(rate)} bracket.`,
      worthCents: short,
      worthKind: "risk",
      rankCents: Math.round(short * DETECTOR_RATES.tax.rankShareOfBill),
      confidence: weakest([
        factEvidence(plan),
        factEvidence(income),
        assumed
          ? {
              percent: Math.min(plan.confidence, 70),
              reason: `no vest schedule yet, so I assumed ${pct(DETECTOR_RATES.tax.stockVestShare)} of your ${formatCents(stock)} plan vests this year`,
            }
          : { percent: 90, reason: "your vests this year and your tax bracket" },
      ]),
      urgency: Number(profile.today.slice(5, 7)) >= 10 ? "soon" : "later",
      why: `Stock that vests is pay the employer withholds at a flat ${pct(flat)} (IRS Pub. 15's rate for supplemental wages), but with your pay plus about ${formatCents(vested)} vesting, your top bracket is ${pct(rate)}. On that, about ${formatCents(short)} is left to pay when you file, beyond what the flat rate took.`,
      action: { label: "See your stock's tax", href: "/taxes/equity" },
    });
  },
};

export const TAX_FACT_DETECTORS: readonly Detector[] = [
  socialSecurityTaxed,
  companyStockShare,
  stockVestTax,
];
