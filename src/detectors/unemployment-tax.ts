import { SOURCES, UNEMPLOYMENT_W4V_RATE } from "@/config/student-taxes";
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
    const base = other.agiCents;
    const tax =
      federalTaxOf(base + paid, status, dependent, other.earnedCents) -
      federalTaxOf(base, status, dependent, other.earnedCents);
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
