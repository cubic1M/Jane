import { FORMS_COMING, SIDE_INCOME } from "@/config/student-taxes";
import { dayLabel } from "@/lib/day-label";
import { formatWholeDollars } from "@/lib/money";
import { studentMoney } from "@/planning/student-money";
import { onStudentVisa } from "@/planning/student-tax";
import { employerName } from "@/profile/employer-name";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { evidence, nice } from "./helpers";

// The tax forms on the way (suggest-taxes gap pass): from December to mid-February, the forms each
// payer Jane sees will send for the year, and by when, so a student knows what to wait for before
// filing and what never comes (a fellowship has no W-2 or 1099). A fact; pure.

// January 31 of the year after, or the Monday after when it falls on a weekend.
export function formsDue(year: number): string {
  const day = new Date(`${year + 1}-${FORMS_COMING.dueMonthDay}T00:00:00Z`);
  const add = day.getUTCDay() === 6 ? 2 : day.getUTCDay() === 0 ? 1 : 0;
  return new Date(day.getTime() + add * 86_400_000).toISOString().slice(0, 10);
}

const taxFormsComing: Detector = {
  capability: "taxes",
  topic: "tax_forms_coming",
  covers: ["tax_forms"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const md = profile.today.slice(5);
    if (md < FORMS_COMING.from && md > FORMS_COMING.until) return null;
    const year = Number(profile.today.slice(0, 4)) - (md <= FORMS_COMING.until ? 1 : 0);
    const money = studentMoney({ ...data, today: `${year}-12-31` });
    const due = dayLabel(formsDue(year), { long: true, year: true });
    const visa = onStudentVisa(profile.facts);
    const employers = [...new Set(money.wages.map((t) => nice(employerName(t.description))))];
    const schools = [...new Set(money.tuition.map((t) => nice(t.description).split(" ")[0]))];
    const lenders = [...new Set(money.loanPayments.map((t) => nice(t.description).split(" ")[0]))];
    const payouts = data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        t.date.startsWith(`${year}-`) &&
        (t.pfc === "INCOME_CONTRACTOR" || t.pfc === "INCOME_GIG_ECONOMY"),
    );
    const platforms = [...new Set(payouts.map((t) => nice(t.description).split(" ")[0]))];
    const lines = [
      ...employers.map((e) => `a W-2 from ${e} by ${due}`),
      ...schools.map((s) => `a Form 1098-T from ${s} (tuition) by ${due}`),
      ...lenders.map(
        (l) =>
          `a Form 1098-E from ${l} by ${due}, if the year's interest reached ${formatWholeDollars(FORMS_COMING.loanInterestFormFromCents)}`,
      ),
      ...platforms.map(
        (p) =>
          `from ${p}, a Form 1099-K only above ${formatWholeDollars(SIDE_INCOME.appThreshold.cents)} and ${SIDE_INCOME.appThreshold.payments} payments (a client may send a 1099-NEC); the income counts either way`,
      ),
      ...(money.schoolDeposits.some((t) => /\bSTANFORD\b/i.test(t.description))
        ? [
            visa
              ? "a Form 1042-S from Stanford in March, for the fellowship and the tax withheld from it"
              : "for the fellowship, no W-2 or 1099: Stanford mails a letter in January summing payments over $600",
          ]
        : []),
    ];
    if (lines.length === 0) return null;
    return suggestion("taxes", "tax_forms_coming", {
      title: `${lines.length} tax form${lines.length === 1 ? "" : "s"} for ${year} should reach you by ${due}`,
      headline: `Note the ${year} tax forms on the way`,
      short: `${lines.length} form${lines.length === 1 ? "" : "s"} from the payers in your accounts, most by ${due}.`,
      worthCents: 0,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, lines.length, "payers"),
      urgency: "later",
      why: `From the payers in your accounts, for ${year}: ${lines.join("; ")}. Employers and schools send these by January 31, or the next business day (IRS).`,
      action: { label: "See your forms", href: "/taxes?focus=records:forms" },
    });
  },
};

export const TAX_FORM_DETECTORS: readonly Detector[] = [taxFormsComing];
