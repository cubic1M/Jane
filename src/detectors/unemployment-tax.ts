import { SOURCES, UNEMPLOYMENT_W4V_RATE } from "@/config/student-taxes";
import { ownLawYear } from "@/config/tax-params";
import { TAX_SET_ASIDE } from "@/config/tax-set-aside";
import { formatCents } from "@/lib/money";
import { sumCents } from "@/planning/student-money";
import { dependentOf, federalTaxOf, filingStatusOf, studentYearOf } from "@/planning/student-tax";
import { rateMonthsOf } from "@/profile/build";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { evidence, headlineOf, weakest } from "./helpers";
import { datesLine } from "./student-taxes";

// Unemployment pay (suggest-taxes gap pass): federal income (IRS Topic 418), withheld only at Form
// W-4V's 10% when the person chose it, and not taxed by California (FTB). A graduate between jobs or
// a laid-off first-jobber meets it in April. The federal tax on what's been paid so far, on top of the
// year's other pay at its pace. A fact; pure.

// Taxable income the student pay model doesn't read: pensions and retirement payouts, dividends and
// interest, this year so far, paced to a year over the months the rows cover. They arrive gross.
const OTHER_TAXABLE = new Set([
  "INCOME_RETIREMENT_PENSION",
  "INCOME_DIVIDENDS",
  "INCOME_INTEREST_EARNED",
]);
const DAY_MS = 86_400_000;
function otherTaxableYear(data: Parameters<Detector["detect"]>[0]["data"], today: string) {
  const year = today.slice(0, 4);
  const rows = data.transactions.filter(
    (t) =>
      t.amountCents < 0 &&
      t.date.startsWith(`${year}-`) &&
      t.date <= today &&
      OTHER_TAXABLE.has(t.pfc ?? ""),
  );
  if (rows.length === 0) return 0;
  const first = data.transactions.reduce((a, t) => (t.date < a ? t.date : a), today);
  const from = first < `${year}-01-01` ? `${year}-01-01` : first;
  // To the newest row on or before today, as studentYearOf does: months after the statements stop
  // hold no rows, so pacing over them would shrink the year.
  const last = data.transactions.reduce(
    (a, t) => (t.date <= today && t.date > a ? t.date : a),
    from,
  );
  const months = Math.max(1, (Date.parse(last) - Date.parse(from)) / DAY_MS / (365.25 / 12));
  return Math.round((sumCents(rows) * 12) / months);
}

const unemploymentTax: Detector = {
  capability: "taxes",
  topic: "unemployment_tax",
  covers: ["tax_estimate"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const { facts } = profile;
    const year = Number(profile.today.slice(0, 4));
    const ui = data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        t.date.startsWith(`${year}-`) &&
        t.date <= profile.today &&
        t.pfc === "INCOME_UNEMPLOYMENT",
    );
    if (ui.length === 0) return null;
    const paid = sumCents(ui);
    const other = studentYearOf(data, facts, rateMonthsOf(profile));
    const status = filingStatusOf(facts);
    const dependent = dependentOf(facts) === "yes";
    const base = other.agiCents + otherTaxableYear(data, profile.today);
    const tax =
      federalTaxOf(base + paid, status, dependent, other.earnedCents, ownLawYear(year)) -
      federalTaxOf(base, status, dependent, other.earnedCents, ownLawYear(year));
    if (tax < TAX_SET_ASIDE.minLeftCents) return null;
    const ca = facts.home_state.value === "CA" ? " California doesn't tax it (FTB)." : "";
    return suggestion("taxes", "unemployment_tax", {
      title: `Unemployment pay is federal income: about ${formatCents(tax)} of tax on the ${formatCents(paid)} paid so far`,
      headline: headlineOf("Check tax on unemployment pay", tax, "risk"),
      short: `${formatCents(paid)} of unemployment this year; tax comes out only if you chose 10%.`,
      worthCents: tax,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, ui.length, "unemployment payments"),
        { percent: 55, reason: "I can't see whether 10% is already withheld from it" },
      ]),
      urgency: "later",
      why: `You've been paid ${formatCents(paid)} of unemployment this year. It counts in federal income (IRS Topic 418): with your other income at its pace, about ${formatCents(tax)} of federal tax. The payer withholds federal tax only when a Form W-4V asks it to, at ${Math.round(UNEMPLOYMENT_W4V_RATE * 100)}% of each payment, and the Form 1099-G in January shows what was paid and withheld.${ca} ${datesLine(profile.today, facts.home_state.value)}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [
        { label: "IRS: unemployment compensation", href: SOURCES.unemploymentIrs.url },
        { label: "FTB: unemployment", href: SOURCES.unemploymentFtb.url },
      ],
    });
  },
};

export const UNEMPLOYMENT_TAX_DETECTORS: readonly Detector[] = [unemploymentTax];
