import {
  CHILDCARE_HINT_CATEGORIES,
  STATE_AGENCY_CATEGORIES,
  FILING_STATUSES,
  INCOME_KIND_ORDER,
  INCOME_KINDS,
  TAX_PROFILE_MIN_PAYCHECKS,
  TAX_PROFILE_PAYERS_SHOWN,
  TAXABLE_INVESTMENT_SUBTYPES,
  type FilingStatus,
  type IncomeKind,
} from "@/config/tax";
import { US_STATES } from "@/config/referrals";

// The tax profile (spec step 118): what Jane needs to know for the person's taxes, worked
// out from their transactions where it can be and asked where it can't. Pure.
//
// Nothing is assumed silently: every field is either the person's own answer ("yours"),
// something Jane found and shows with where she found it ("found", waiting for a yes), or
// "missing". Every answer can be changed.

export type ProfileField = "incomeKinds" | "filingStatus" | "dependants" | "state";
// The order the chat asks in.
export const PROFILE_FIELDS: readonly ProfileField[] = [
  "incomeKinds",
  "filingStatus",
  "dependants",
  "state",
];
export const isProfileField = (value: unknown): value is ProfileField =>
  typeof value === "string" && (PROFILE_FIELDS as readonly string[]).includes(value);

// What the person told Jane (the tax_profiles row), or null before any answer.
export type StoredTaxProfile = {
  filingStatus: string | null;
  childrenUnder17: number | null;
  otherDependants: number | null;
  state: string | null;
  incomeKinds: string[];
  answered: string[];
};

export type ProfileTransaction = {
  date: string;
  amountCents: number;
  pfcDetailed: string | null;
  description: string;
  merchantName: string | null;
};

export type ProfileAccount = { name: string; type: string; subtype: string | null };

// One kind of income Jane spotted, with who paid it, so she can say where she saw it.
export type FoundIncome = {
  kind: IncomeKind;
  // Payers (or accounts) most paid first, at most TAX_PROFILE_PAYERS_SHOWN.
  from: string[];
  // Money in over the period looked at (positive).
  totalCents: number;
};

export type FoundFacts = {
  income: FoundIncome[];
  // A state from the person's settings, or from a state agency they paid (a "CA DMV"
  // registration), with where it came from.
  state: { code: string; from: string } | null;
  // Childcare spending seen, or a new-baby checklist: Jane mentions it, never assumes.
  childrenHint: boolean;
};

const payerOf = (t: ProfileTransaction) => (t.merchantName ?? t.description).trim();

// The income Jane can see: money in under each kind's categories (wages only once paid
// at least TAX_PROFILE_MIN_PAYCHECKS times), and taxable investment accounts.
export function findTaxFacts(input: {
  transactions: ProfileTransaction[];
  accounts: ProfileAccount[];
  settingsState: string | null;
  newBaby: boolean;
}): FoundFacts {
  const income: FoundIncome[] = [];
  for (const kind of INCOME_KIND_ORDER) {
    const categories: readonly string[] = INCOME_KINDS[kind].categories;
    const paid = input.transactions.filter(
      (t) => t.amountCents < 0 && t.pfcDetailed !== null && categories.includes(t.pfcDetailed),
    );
    const byPayer = new Map<string, number>();
    for (const t of paid) byPayer.set(payerOf(t), (byPayer.get(payerOf(t)) ?? 0) - t.amountCents);
    const accounts =
      kind === "investment"
        ? input.accounts.filter(
            (a) => a.type === "investment" && TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? ""),
          )
        : [];
    if (kind === "w2" && paid.length < TAX_PROFILE_MIN_PAYCHECKS) continue;
    if (paid.length === 0 && accounts.length === 0) continue;
    const payers = [...byPayer.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    income.push({
      kind,
      from: [...accounts.map((a) => a.name), ...payers].slice(0, TAX_PROFILE_PAYERS_SHOWN),
      totalCents: paid.reduce((sum, t) => sum - t.amountCents, 0),
    });
  }
  const childcare = input.transactions.some(
    (t) =>
      t.amountCents > 0 &&
      t.pfcDetailed !== null &&
      (CHILDCARE_HINT_CATEGORIES as readonly string[]).includes(t.pfcDetailed),
  );
  return { income, state: stateOf(input), childrenHint: childcare || input.newBaby };
}

const isState = (code: string | null) => US_STATES.some((s) => s.code === code);

// Settings first; else the most recent payment to a state agency that starts with the
// state's code ("CA DMV VEHICLE REGISTRATION", "NY DEPT TAXATION").
function stateOf(input: {
  transactions: ProfileTransaction[];
  settingsState: string | null;
}): FoundFacts["state"] {
  if (input.settingsState && isState(input.settingsState)) {
    return { code: input.settingsState, from: "your settings" };
  }
  const agency = input.transactions
    .filter(
      (t) =>
        t.amountCents > 0 &&
        t.pfcDetailed !== null &&
        (STATE_AGENCY_CATEGORIES as readonly string[]).includes(t.pfcDetailed),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((t) => isState(t.description.slice(0, 2)) && /^[A-Z]{2} /.test(t.description));
  return agency
    ? { code: agency.description.slice(0, 2), from: `a ${payerOf(agency)} payment` }
    : null;
}

export type FieldStatus = "yours" | "found" | "missing";

export type TaxProfileView = {
  incomeKinds: { status: FieldStatus; value: IncomeKind[]; found: FoundIncome[] };
  filingStatus: { status: FieldStatus; value: FilingStatus | null };
  dependants: {
    status: FieldStatus;
    childrenUnder17: number | null;
    otherDependants: number | null;
    hint: boolean;
  };
  state: { status: FieldStatus; value: string | null; from: string | null };
  // Kinds of income seen since the person last answered, not on their profile.
  newIncome: FoundIncome[];
  // The first field still waiting for an answer, in the order the chat asks.
  next: ProfileField | null;
  complete: boolean;
};

const answeredOf = (stored: StoredTaxProfile | null, field: ProfileField) =>
  stored?.answered.includes(field) ?? false;

export function taxProfileView(stored: StoredTaxProfile | null, found: FoundFacts): TaxProfileView {
  const foundKinds = found.income.map((i) => i.kind);
  const incomeAnswered = answeredOf(stored, "incomeKinds");
  const yourKinds = INCOME_KIND_ORDER.filter((k) => stored?.incomeKinds.includes(k));
  const filing =
    answeredOf(stored, "filingStatus") &&
    stored?.filingStatus &&
    Object.hasOwn(FILING_STATUSES, stored.filingStatus)
      ? (stored.filingStatus as FilingStatus)
      : null;
  const dependantsAnswered = answeredOf(stored, "dependants");
  const stateAnswered = answeredOf(stored, "state") && Boolean(stored?.state);

  const view: Omit<TaxProfileView, "next" | "complete"> = {
    incomeKinds: incomeAnswered
      ? { status: "yours", value: yourKinds, found: found.income }
      : foundKinds.length > 0
        ? { status: "found", value: foundKinds, found: found.income }
        : { status: "missing", value: [], found: [] },
    filingStatus: { status: filing ? "yours" : "missing", value: filing },
    dependants: dependantsAnswered
      ? {
          status: "yours",
          childrenUnder17: stored?.childrenUnder17 ?? 0,
          otherDependants: stored?.otherDependants ?? 0,
          hint: found.childrenHint,
        }
      : {
          status: "missing",
          childrenUnder17: null,
          otherDependants: null,
          hint: found.childrenHint,
        },
    state: stateAnswered
      ? { status: "yours", value: stored!.state, from: null }
      : found.state
        ? { status: "found", value: found.state.code, from: found.state.from }
        : { status: "missing", value: null, from: null },
    newIncome: incomeAnswered ? found.income.filter((i) => !yourKinds.includes(i.kind)) : [],
  };
  const next = PROFILE_FIELDS.find((f) => view[f].status !== "yours") ?? null;
  return { ...view, next, complete: next === null };
}

// The profile Jane works with: the person's answers, plus what she found when she may use
// it (src/config/tax.ts usesFoundAnswers). Missing stays missing.
export type WorkingProfile = {
  filingStatus: FilingStatus | null;
  childrenUnder17: number;
  otherDependants: number;
  state: string | null;
  incomeKinds: IncomeKind[];
  // Fields filled in from what Jane found, not yet checked by the person.
  unconfirmed: ProfileField[];
};

export function workingProfile(view: TaxProfileView, useFound: boolean): WorkingProfile {
  const take = <T>(field: { status: FieldStatus }, value: T, empty: T): T =>
    field.status === "yours" || (useFound && field.status === "found") ? value : empty;
  return {
    filingStatus: view.filingStatus.value,
    childrenUnder17: view.dependants.childrenUnder17 ?? 0,
    otherDependants: view.dependants.otherDependants ?? 0,
    state: take(view.state, view.state.value, null),
    incomeKinds: take(view.incomeKinds, view.incomeKinds.value, []),
    unconfirmed: useFound ? PROFILE_FIELDS.filter((f) => view[f].status === "found") : [],
  };
}

export const stateName = (code: string | null) =>
  US_STATES.find((s) => s.code === code)?.name ?? null;

// "wages from ACME CORP PAYROLL (W-2)".
export function incomeLine(found: FoundIncome): string {
  const kind = INCOME_KINDS[found.kind];
  const from = found.from.length > 0 ? ` from ${found.from.join(" and ")}` : "";
  return `${kind.seen}${from} (${kind.form})`;
}

// "a, b and c".
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
