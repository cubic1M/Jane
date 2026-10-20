import { COMPARE_RUNNERS_UP, OPTION_MIN_SAVING_CENTS, type OptionKind } from "@/config/compare";

// The best option for this person (spec step 76). Given what they pay now and the options
// Jane knows, works out what each would cost (or earn) them in a year and picks the best:
// for a bill or a subscription, the lowest first-year cost for the same kind of service;
// for idle cash, the highest earnings they qualify for. Only options that beat what they
// have by OPTION_MIN_SAVING_CENTS count. Pure, and no advice: it compares prices.

export type CompareOption = {
  id: string;
  kind: OptionKind;
  category: string | null;
  merchantKey: string | null;
  provider: string;
  name: string;
  monthlyCents: number | null;
  apyBps: number | null;
  contractMonths: number;
  oneTimeFeeCents: number;
  minimumBalanceCents: number;
  includes: string | null;
  givesUp: string | null;
  signUpUrl: string | null;
  sourceUrl: string;
  // YYYY-MM-DD.
  checkedAt: string;
  demo: boolean;
};

export type Current =
  // A bill or subscription: what it costs a month now, its kind (for other providers'
  // plans) and the service itself (for its own cheaper tiers).
  | { kind: "bill"; monthlyCents: number; category: string | null; merchantKey: string | null }
  // Idle cash: how much could move and the rate it earns now.
  | { kind: "savings"; amountCents: number; currentRateBps: number };

export type Scored = {
  option: CompareOption;
  // Bills: what the first year would cost, fees included. Savings: what it would earn.
  firstYearCents: number;
  // Against what they have now, for the first year.
  savingCents: number;
  // Plain words for what's different: a contract, a fee, what's given up.
  notes: string[];
};

export type Comparison = {
  current: Current;
  // What they pay (bills) or earn (savings) in a year now.
  currentYearCents: number;
  pick: Scored;
  runnersUp: Scored[];
  // Why the pick, in one sentence.
  why: string;
};

const BASIS_POINTS = 10_000;
const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });

function notesFor(option: CompareOption): string[] {
  const notes: string[] = [];
  if (option.contractMonths > 0) notes.push(`${option.contractMonths}-month contract`);
  if (option.oneTimeFeeCents > 0) notes.push(`${dollars(option.oneTimeFeeCents)} one-time fee`);
  if (option.minimumBalanceCents > 0) {
    notes.push(`Needs at least ${dollars(option.minimumBalanceCents)}`);
  }
  if (option.givesUp) notes.push(option.givesUp);
  return notes;
}

const sameService = (option: CompareOption, current: Extract<Current, { kind: "bill" }>) =>
  option.kind === "tier"
    ? current.merchantKey !== null && option.merchantKey === current.merchantKey
    : option.kind === "plan" &&
      current.category !== null &&
      option.category === current.category &&
      // Another provider's plan, not the one they already have.
      option.merchantKey !== current.merchantKey;

function scoreBill(current: Extract<Current, { kind: "bill" }>, options: CompareOption[]) {
  const currentYear = current.monthlyCents * 12;
  return (
    options
      .filter((o) => o.monthlyCents !== null && sameService(o, current))
      .map((option) => {
        const firstYear = option.monthlyCents! * 12 + option.oneTimeFeeCents;
        return {
          option,
          firstYearCents: firstYear,
          savingCents: currentYear - firstYear,
          notes: notesFor(option),
        };
      })
      // The biggest saving first; on a tie, fewer strings attached.
      .sort(
        (a, b) =>
          b.savingCents - a.savingCents ||
          a.option.contractMonths - b.option.contractMonths ||
          a.notes.length - b.notes.length ||
          a.option.name.localeCompare(b.option.name),
      )
  );
}

function scoreSavings(current: Extract<Current, { kind: "savings" }>, options: CompareOption[]) {
  const currentYear = Math.round((current.amountCents * current.currentRateBps) / BASIS_POINTS);
  return options
    .filter(
      (o) =>
        o.kind === "savings" && o.apyBps !== null && o.minimumBalanceCents <= current.amountCents,
    )
    .map((option) => {
      // A monthly fee would count against it; savings options carry none here.
      const earns = Math.round((current.amountCents * option.apyBps!) / BASIS_POINTS);
      return {
        option,
        firstYearCents: earns,
        savingCents: earns - currentYear,
        notes: notesFor(option),
      };
    })
    .sort(
      (a, b) =>
        b.savingCents - a.savingCents ||
        a.notes.length - b.notes.length ||
        a.option.name.localeCompare(b.option.name),
    );
}

// An option as people read it: "Pine Mobile Unlimited", not "Pine Mobile Pine Mobile
// Unlimited", when the plan's name already starts with the company's.
export function optionLabel(option: Pick<CompareOption, "provider" | "name">): string {
  const first = option.provider.split(/\s+/)[0].toLowerCase();
  return option.name.toLowerCase().startsWith(first)
    ? option.name
    : `${option.provider} ${option.name}`;
}

export function compareOptions(current: Current, options: CompareOption[]): Comparison | null {
  const scored = (
    current.kind === "bill" ? scoreBill(current, options) : scoreSavings(current, options)
  ).filter((s) => s.savingCents >= OPTION_MIN_SAVING_CENTS);
  const [pick, ...rest] = scored;
  if (!pick) return null;
  const currentYearCents =
    current.kind === "bill"
      ? current.monthlyCents * 12
      : Math.round((current.amountCents * current.currentRateBps) / BASIS_POINTS);
  const why =
    current.kind === "bill"
      ? scored.length === 1
        ? "It's the one option we compared for the same kind of service that costs less in the first year, fees included."
        : `Of the ${scored.length} options we compared for the same kind of service, it costs the least in the first year, fees included.`
      : scored.length === 1
        ? `It's the one account we compared that you qualify for that earns more on ${dollars(current.amountCents)}.`
        : `Of the ${scored.length} accounts we compared that you qualify for, it earns the most on ${dollars(current.amountCents)}.`;
  return { current, currentYearCents, pick, runnersUp: rest.slice(0, COMPARE_RUNNERS_UP), why };
}
