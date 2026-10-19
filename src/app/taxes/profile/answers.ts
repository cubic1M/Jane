import { INCOME_KIND_ORDER, isFilingStatus, type IncomeKind } from "@/config/tax";
import { parseMoneyToCents } from "@/lib/money";
import { TaxProfileError, type PayStubEntry, type TaxAnswer } from "@/lib/tax-profile";

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
