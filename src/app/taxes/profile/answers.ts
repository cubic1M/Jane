import { INCOME_KIND_ORDER, isFilingStatus, type IncomeKind } from "@/config/tax";
import { parseMoneyToCents } from "@/lib/money";
import { TaxProfileError, type PayStubEntry, type TaxAnswer } from "@/lib/tax-profile";
import { ResidencyError } from "@/lib/tax-states";
import { FamilyTaxesError, type FamilyDetails } from "@/lib/family-taxes";
import { HomeTaxesError, type HomeAnswers } from "@/lib/home-taxes";
import { SideIncomeError, type SideIncomeAnswers } from "@/lib/side-income";

// The tax profile form's answers (spec step 118). A field left empty stays unanswered.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// Pure: the answers in the form. Throws TaxProfileError for a value that isn't a number.
export function answersFrom(formData: FormData): TaxAnswer[] {
  const answers: TaxAnswer[] = [];
  const kinds = formData.getAll("incomeKinds").map(String);
  if (kinds.length > 0 || formData.get("noIncome")) {
    answers.push({
      field: "incomeKinds",
      value: INCOME_KIND_ORDER.filter((k) => kinds.includes(k)) as IncomeKind[],
    });
  }
  const filing = text(formData, "filingStatus");
  if (filing) {
    if (!isFilingStatus(filing)) throw new TaxProfileError("Pick a filing status.");
    answers.push({ field: "filingStatus", value: filing });
  }
  const children = text(formData, "childrenUnder17");
  const others = text(formData, "otherDependants");
  if (children || others) {
    const number = (v: string) => (v === "" ? 0 : /^\d+$/.test(v) ? Number(v) : NaN);
    answers.push({
      field: "dependants",
      childrenUnder17: number(children),
      otherDependants: number(others),
    });
  }
  const state = text(formData, "state");
  if (state) answers.push({ field: "state", value: state });
  return answers;
}

// Spec step 120: the pay stub form. Empty gross pay clears it.
export function payStubFrom(formData: FormData): PayStubEntry | null {
  const gross = text(formData, "payGross");
  if (!gross) return null;
  const money = (name: string) => {
    const value = text(formData, name);
    if (!value) return 0;
    const cents = parseMoneyToCents(value);
    if (cents === null)
      throw new TaxProfileError("Amounts must be dollars and cents, like 1,234.56.");
    return cents;
  };
  return {
    asOf: text(formData, "payAsOf"),
    grossCents: money("payGross"),
    federalCents: money("payFederal"),
    stateCents: money("payState"),
    retirementCents: money("payRetirement"),
    pretaxCents: money("payPretax"),
  };
}

// Spec step 165: where the person lived and worked. A move (date, from, to), or "one state
// all year"; the employer's state ("" for the same state); the city income tax ("" leaves
// it as it is, "none" for none).
export type ResidencyEntry = {
  move: { date: string; from: string; to: string } | null;
  oneState: boolean;
  workState: string | null;
  locality: string | null;
};

export function residencyFrom(formData: FormData): ResidencyEntry {
  const date = text(formData, "movedOn");
  const from = text(formData, "movedFrom");
  const to = text(formData, "movedTo");
  if ((date || from || to) && !(date && from && to)) {
    throw new ResidencyError("For a move, give the date and both states.");
  }
  return {
    move: date ? { date, from, to } : null,
    oneState: !date && Boolean(formData.get("oneState")),
    workState: text(formData, "workState") || null,
    locality: text(formData, "locality") || null,
  };
}

// Spec step 169: family details. Up to FAMILY_FORM_CHILDREN children (a row with no age is
// left out), a spouse's wages, whether the person pays over half the home's costs, and a
// student's years of college before this one.
export const FAMILY_FORM_CHILDREN = 4;

export function familyFrom(formData: FormData): FamilyDetails {
  const children: FamilyDetails["children"] = [];
  for (let i = 0; i < FAMILY_FORM_CHILDREN; i += 1) {
    const age = text(formData, `childAge${i}`);
    if (!age) continue;
    const months = text(formData, `childMonths${i}`);
    children.push({
      ageAtYearEnd: Number(age),
      hasSsn: Boolean(formData.get(`childSsn${i}`)),
      monthsLivedWithYou: months ? Number(months) : 12,
    });
  }
  const wages = text(formData, "spouseWages");
  const spouseWagesCents = wages ? parseMoneyToCents(wages) : null;
  if (wages && spouseWagesCents === null) {
    throw new FamilyTaxesError("Your spouse's wages must be dollars and cents.");
  }
  const years = text(formData, "studentYears");
  return {
    children,
    spouseWagesCents,
    paysOverHalfHome: formData.get("paysOverHalfHome") ? true : null,
    student: years
      ? { yearsOfCollegeBefore: Number(years), halfTime: Boolean(formData.get("studentHalfTime")) }
      : null,
  };
}

// Spec step 170: points and a home sale. Empty points or sale price clears that part.
export function homeFrom(formData: FormData, year: number): HomeAnswers {
  const cents = (name: string) => {
    const value = text(formData, name);
    if (!value) return 0;
    const parsed = parseMoneyToCents(value);
    if (parsed === null) throw new HomeTaxesError("Amounts must be dollars and cents.");
    return parsed;
  };
  const points = text(formData, "points");
  const sale = text(formData, "sale");
  return {
    points: points
      ? {
          cents: cents("points"),
          year,
          purchase: Boolean(formData.get("pointsPurchase")),
          loanYears: Number(text(formData, "pointsLoanYears") || "30"),
        }
      : null,
    sale: sale
      ? {
          boughtOn: text(formData, "boughtOn"),
          priceCents: cents("price"),
          soldOn: text(formData, "soldOn"),
          saleCents: cents("sale"),
          costsCents: cents("costs"),
          daysLivedIn: Number(text(formData, "daysLivedIn") || "0"),
        }
      : null,
  };
}

// Spec step 173: the rental property and hobby or business. Empty price clears the rental.
export function sideIncomeFrom(formData: FormData): SideIncomeAnswers {
  const price = text(formData, "rentalPrice");
  const cents = price ? parseMoneyToCents(price) : null;
  if (price && cents === null) throw new SideIncomeError("Give the price in dollars and cents.");
  const kind = text(formData, "sideIncomeKind");
  return {
    rental: cents ? { priceCents: cents, placedOn: text(formData, "rentalPlacedOn") } : null,
    kind: kind === "business" || kind === "hobby" ? kind : null,
  };
}
