import { INCOME_KIND_ORDER, isFilingStatus, type IncomeKind } from "@/config/tax";
import { TaxProfileError, type TaxAnswer } from "@/lib/tax-profile";

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
