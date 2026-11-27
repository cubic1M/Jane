import {
  CHILD_TAX_CREDIT_AGE,
  CHILDCARE_HINT_CATEGORIES,
  STATE_AGENCY_CATEGORIES,
  STATE_TAX_AGENCIES,
  FILING_STATUSES,
  INCOME_KIND_ORDER,
  INCOME_KINDS,
  isFilingStatus,
  TAX_PROFILE_MIN_PAYCHECKS,
  TAX_PROFILE_PAYERS_SHOWN,
  TAXABLE_INVESTMENT_SUBTYPES,
  type FilingStatus,
  type IncomeKind,
} from "@/config/tax";
import { US_STATES } from "@/config/referrals";
import { formPayer } from "./tax-documents";

// The tax profile (spec step 118): what Jane needs to know for the person's taxes, worked
// out from their transactions where it can be and asked where it can't. Pure.
//
// Nothing is assumed silently: every field is either the person's own answer ("yours"),
// something Jane found and shows with where it found it ("found", waiting for a yes), or
// "missing". Every answer can be changed.

export type ProfileField = "incomeKinds" | "filingStatus" | "dependants" | "state";
// The order the chat asks in.
export const PROFILE_FIELDS: readonly ProfileField[] = [
  "incomeKinds",
  "filingStatus",
  "dependants",
  "state",
];

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

// One kind of income Jane spotted, with who paid it, so it can say where it saw it.
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
  // Who the household the person listed for insurance says they could claim (children under
  // 17, and older children), for them to confirm with one tap. Null with no household listed.
  dependants: { childrenUnder17: number; otherDependants: number; from: string } | null;
};

// "2 children under 17 and 1 other dependant", for the found answer and the estimate.
export const dependantsWords = (children: number, others: number) =>
  [
    children > 0 ? `${children} ${children === 1 ? "child" : "children"} under 17` : null,
    others > 0 ? `${others} other ${others === 1 ? "dependant" : "dependants"}` : null,
  ]
    .filter(Boolean)
    .join(" and ") || "no dependants";

// A person in the household listed for insurance (src/lib/insurance/family-rules.ts).
export type HouseholdMember = { relation: string; age: number | null };

// Children in the household: under 17 (an age not given counts as under 17, as most listed
// children are), and older ones as other dependants. A spouse or someone else isn't counted.
export function dependantsFromHousehold(
  people: readonly HouseholdMember[],
): FoundFacts["dependants"] {
  const children = people.filter((p) => p.relation === "child");
  if (children.length === 0) return null;
  const under = children.filter((c) => c.age === null || c.age < CHILD_TAX_CREDIT_AGE).length;
  return {
    childrenUnder17: under,
    otherDependants: children.length - under,
    from: "the household on your insurance page",
  };
}

// A blank merchant name is no name: the description says who it was.
const payerOf = (t: ProfileTransaction) => (t.merchantName?.trim() || t.description).trim();

// The income Jane can see: money in under each kind's categories (wages only once paid
// at least TAX_PROFILE_MIN_PAYCHECKS times), and taxable investment accounts.
export function findTaxFacts(input: {
  transactions: ProfileTransaction[];
  accounts: ProfileAccount[];
  settingsState: string | null;
  newBaby: boolean;
  household?: readonly HouseholdMember[];
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
  return {
    income,
    state: stateOf(input),
    childrenHint: childcare || input.newBaby,
    dependants: dependantsFromHousehold(input.household ?? []),
  };
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
    .map((t) => ({ t, code: agencyState(t.description.toUpperCase()) }))
    .find((a) => a.code !== null);
  return agency ? { code: agency.code!, from: `a ${payerOf(agency.t)} payment` } : null;
}

// "CA DMV …", "COLORADO DEPT OF REVENUE", or a state tax agency known by its own name.
function agencyState(line: string): string | null {
  if (/^[A-Z]{2} /.test(line) && isState(line.slice(0, 2))) return line.slice(0, 2);
  const named = STATE_TAX_AGENCIES.find(([pattern]) => pattern.test(line));
  if (named) return named[1];
  return US_STATES.find((s) => line.startsWith(`${s.name.toUpperCase()} `))?.code ?? null;
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
    // Where found dependants came from, when the status is "found".
    from: string | null;
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
          from: null,
        }
      : found.dependants
        ? {
            status: "found",
            childrenUnder17: found.dependants.childrenUnder17,
            otherDependants: found.dependants.otherDependants,
            hint: found.childrenHint,
            from: found.dependants.from,
          }
        : {
            status: "missing",
            childrenUnder17: null,
            otherDependants: null,
            hint: found.childrenHint,
            from: null,
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

// The profile Jane works with: the person's answers, plus what it found when it may use
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
    childrenUnder17: take(view.dependants, view.dependants.childrenUnder17 ?? 0, 0),
    otherDependants: take(view.dependants, view.dependants.otherDependants ?? 0, 0),
    state: take(view.state, view.state.value, null),
    incomeKinds: take(view.incomeKinds, view.incomeKinds.value, []),
    unconfirmed: useFound ? PROFILE_FIELDS.filter((f) => view[f].status === "found") : [],
  };
}

export const stateName = (code: string | null) =>
  US_STATES.find((s) => s.code === code)?.name ?? null;

// "wages from ACME CORP (W-2)".
export function incomeLine(found: FoundIncome): string {
  const kind = INCOME_KINDS[found.kind];
  // Who pays, as the forms list says it (formPayer): "wages from Campus Dining Payroll Ppd" read
  // the bank's line, beside "W-2 from Campus Dining" (debug 2, 11-16).
  const from = found.from.length > 0 ? ` from ${found.from.map(formPayer).join(" and ")}` : "";
  return `${kind.seen}${from} (${kind.form})`;
}

// "a, b and c".
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The employer in a pay line: the label cut at the words a bank adds ("ACME PAYROLL PPD",
// "ACME DIRECT DEP" and "ACME SALARY" are one payer, not two).
const employerOfPayroll = (name: string) =>
  name
    .replace(/\s+(?:PAYROLL|DIRECT\s+DEP(?:OSIT)?|DIR\s+DEP|PPD|SALARY|WAGES)\b.*$/i, "")
    .trim()
    .toUpperCase();

// The paychecks that could be a couple's: from employers paying over the same time. One employer
// after another is one person changing jobs, so only the latest counts (debugger 11-03: "I see two
// employers' paychecks", and $4,097 of tax on $70,000). A single deposit isn't an employer either: a
// bonus's own line, a reimbursement or a day's work isn't someone else's job (debugger 11-05).
export function payingTogether(
  paychecks: readonly { description: string; date: string }[],
): string[] {
  const all = new Map<string, { first: string; last: string; count: number }>();
  for (const { description, date } of paychecks) {
    const key = employerOfPayroll(description);
    const span = all.get(key);
    all.set(key, {
      first: span && span.first < date ? span.first : date,
      last: span && span.last > date ? span.last : date,
      count: (span?.count ?? 0) + 1,
    });
  }
  const repeated = [...all].filter(([, span]) => span.count >= 2);
  const spans = new Map(repeated.length > 0 ? repeated : all);
  const overlaps = (key: string) => {
    const a = spans.get(key);
    // With no employer paying more than once, nothing is concurrent: two one-off deposits on
    // one date aren't two jobs.
    if (!a || repeated.length === 0) return false;
    return [...spans].some(([other, b]) => other !== key && a.first <= b.last && b.first <= a.last);
  };
  const latest = [...spans].sort(([, a], [, b]) => b.last.localeCompare(a.last))[0]?.[0];
  return paychecks
    .filter(({ description }) => {
      const key = employerOfPayroll(description);
      return overlaps(key) || key === latest;
    })
    .map((t) => t.description);
}

// The signs of a couple in the accounts (taxes QA 2026-10-22; debugger 11-03, 11-05): a joint account,
// or two employers' paychecks over the same time. Empty: no such sign. The one place that reads them:
// the estimate calls it with the accounts and paychecks it loaded, the profile builder (for the
// cards) with the same two.
export function coupleSigns(input: {
  jointAccounts: number;
  payrollNames: readonly string[];
}): string[] {
  const employers = new Set(input.payrollNames.map(employerOfPayroll));
  return [
    input.jointAccounts > 0 ? "a joint account" : null,
    employers.size >= 2 ? "two employers' paychecks" : null,
  ].filter((s): s is string => s !== null);
}

// The estimate's sign of a couple as one answer (married filing jointly and why), null when there
// is none: coupleSigns, said as the Taxes page words it.
export function guessFilingStatus(input: {
  jointAccounts: number;
  payrollNames: readonly string[];
}): { status: "married_joint"; why: string } | null {
  const signs = coupleSigns(input);
  return signs.length === 0 ? null : { status: "married_joint", why: signs.join(" and ") };
}

// One filing status (tax program T8, T8b). The question card's answer (a told fact) and the tax
// profile's own row used to be read by different code, so a card, the Taxes page, the estimate and
// the chat could each say something else. Every reader goes through here:
//   1. what the person told Jane. When the two stores hold different answers, the newer one is
//      the person's last word; with no time on one of them, or the same instant, the told fact wins;
//   2. else, for a person who has said nothing, ONE guess (T8b): married filing jointly only on
//      evidence of a partner (a joint account, two employers paying together, or the person's own
//      word that they have a partner); otherwise single.
// Head of household is never guessed. It turns on facts Jane cannot see: unmarried (or considered
// unmarried) on the last day of the year, paid more than half the cost of keeping up the home, and
// a qualifying person who lived there more than half the year (IRS Pub. 501 (2025), "Head of
// Household", read 2026-11-27). A person it could fit (children counted, no sign of a partner) is
// priced as single, and the read says so (`assumption`) so the figure and the card can carry it.
// Times are instants, never days: an answer at 3pm and one at 7pm Pacific are on either side of UTC
// midnight and still in order.

export type FilingSource = "told" | "profile" | "guess" | "default";

export type FilingRead = {
  status: FilingStatus;
  source: FilingSource;
  // The sign of a couple, when that is what the status rests on (the estimate says it).
  guess: { status: "married_joint"; why: string } | null;
  // When two answers disagreed: the one that lost.
  replaced: FilingStatus | null;
  // What Jane assumed, in fact wording, when the person has not said how they file and head of
  // household could fit (children counted, no sign of a partner). Null otherwise.
  assumption: string | null;
};

// Said wherever the single guess stands beside children (the estimate, the cards, the chat).
export const FILING_SINGLE_ASSUMPTION =
  "I've counted you as filing single; if you're unmarried and support a child, head of household may apply and the figure would change. Tell me how you file.";

// The tax_profiles row, as far as filing status goes. `at`: when the person answered it.
export type StoredFiling = {
  filingStatus: string | null;
  answered: readonly string[];
  at: Date | null;
};

export type FilingSignals = {
  // The estimate's raw signs: joint accounts counted, and the payroll lines paying together.
  jointAccounts?: number;
  payrollNames?: readonly string[];
  // Signs already worked out from the same two (a card reads them from the profile's partner fact).
  signs?: readonly string[];
  // The person's own word about a partner: true (has one), false (does not), null or absent (not said).
  // False takes the signs from the accounts back; true is itself the evidence.
  partner?: boolean | null;
  // Children are counted for the person (told, or seen): the only thing head of household could fit.
  children?: boolean;
};

type ToldFiling = Record<string, { value: unknown; at?: Date | null } | undefined>;

export function filingStatusFor(
  facts: ToldFiling,
  taxProfile: StoredFiling | null,
  signals: FilingSignals = {},
): FilingRead {
  const told = facts.filing_status;
  const toldStatus = isFilingStatus(told?.value) ? told.value : null;
  const stored =
    taxProfile?.answered.includes("filingStatus") && isFilingStatus(taxProfile.filingStatus)
      ? taxProfile.filingStatus
      : null;
  if (toldStatus || stored) {
    // The profile row wins over a told fact only when both times are known and it is later.
    const profileNewer =
      toldStatus !== null &&
      stored !== null &&
      stored !== toldStatus &&
      taxProfile?.at != null &&
      told?.at != null &&
      taxProfile.at.getTime() > told.at.getTime();
    const useProfile = stored !== null && (toldStatus === null || profileNewer);
    const status = (useProfile ? stored : toldStatus)!;
    const lost = useProfile ? toldStatus : stored;
    return {
      status,
      source: useProfile ? "profile" : "told",
      guess: null,
      replaced: lost !== null && lost !== status ? lost : null,
      assumption: null,
    };
  }
  const partner = signals.partner ?? null;
  const signs =
    partner === false
      ? []
      : [
          ...(partner === true ? ["what you told me about your partner"] : []),
          ...(signals.signs ?? []),
          ...coupleSigns({
            jointAccounts: signals.jointAccounts ?? 0,
            payrollNames: signals.payrollNames ?? [],
          }),
        ];
  if (signs.length > 0) {
    const guess = { status: "married_joint" as const, why: [...new Set(signs)].join(" and ") };
    return { status: guess.status, source: "guess", guess, replaced: null, assumption: null };
  }
  return {
    status: "single",
    source: "default",
    guess: null,
    replaced: null,
    assumption: signals.children === true ? FILING_SINGLE_ASSUMPTION : null,
  };
}
