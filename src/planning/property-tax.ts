import {
  APPEAL_GAP_RATE,
  APPEAL_MIN_SAVING_CENTS,
  DEFAULT_PROPERTY,
  EXEMPTIONS,
  STATE_PROPERTY,
  type Exemption,
  type StateProperty,
} from "@/config/property-tax";

// Property tax that's too high (spec step 221). Pure: the gap between the county's
// assessment and the home's market value, whether an appeal is worth suggesting, the
// county's window, exemptions the person may not have claimed, and the drafted appeal.
// Every rate and date comes from src/config/property-tax.ts.

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const propertyOf = (state: string | null): StateProperty =>
  (state && STATE_PROPERTY[state]) || DEFAULT_PROPERTY;

export type Comparable = {
  address: string;
  soldOn: string;
  priceCents: number;
  squareFeet: number;
  // The sale price brought to the home's size.
  adjustedCents: number;
};

export type Gap = {
  assessedCents: number;
  marketCents: number;
  gapCents: number;
  gapRate: number;
  // The tax per dollar of assessed value: measured from the tax bill when there is one.
  taxRate: number;
  measured: boolean;
  savingCents: number;
  worthAppealing: boolean;
};

export function assessmentGap(input: {
  assessedCents: number;
  marketCents: number;
  taxPaidCents: number;
  state: string | null;
}): Gap {
  const { assessedCents, marketCents } = input;
  const measured = input.taxPaidCents > 0 && assessedCents > 0;
  const taxRate = measured
    ? input.taxPaidCents / assessedCents
    : propertyOf(input.state).effectiveRate;
  const gapCents = assessedCents - marketCents;
  const gapRate = marketCents > 0 ? gapCents / marketCents : 0;
  const savingCents = Math.max(0, Math.round(gapCents * taxRate));
  return {
    assessedCents,
    marketCents,
    gapCents,
    gapRate,
    taxRate,
    measured,
    savingCents,
    worthAppealing: gapRate >= APPEAL_GAP_RATE && savingCents >= APPEAL_MIN_SAVING_CENTS,
  };
}

export type Window = {
  board: string;
  status: "open" | "upcoming" | "closed" | "unknown";
  opensOn: string | null;
  closesOn: string | null;
  // In words, for the chat and the page.
  text: string;
  source: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A date in words, not 2026-11-30.
const words = (date: string) =>
  `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;

const iso = (y: number, md: string) => `${y}-${md}`;
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// The next window to act in. A fixed window rolls to next year once it has closed; a
// window counted from the notice needs the date the notice was mailed.
export function appealWindow(state: string | null, today: string, noticeOn: string | null): Window {
  const p = propertyOf(state);
  const w = p.window;
  const board = w.board;
  const year = Number(today.slice(0, 4));
  let opensOn: string | null = null;
  let closesOn: string | null = null;
  if (w.closes) {
    const thisYear = iso(year, w.closes);
    closesOn = thisYear >= today ? thisYear : iso(year + 1, w.closes);
    const closeYear = Number(closesOn.slice(0, 4));
    opensOn = w.opens ? iso(closeYear, w.opens) : null;
  }
  if (w.daysAfterNotice !== null && noticeOn) {
    // From the notice, or the state's fixed date in the notice's year if that is later.
    const byNotice = plusDays(noticeOn, w.daysAfterNotice);
    const fixed = w.closes ? iso(Number(noticeOn.slice(0, 4)), w.closes) : null;
    closesOn = fixed && fixed > byNotice ? fixed : byNotice;
    opensOn = noticeOn;
  }
  if (!closesOn) {
    return {
      board,
      status: "unknown",
      opensOn: null,
      closesOn: null,
      text: `Appeals go to ${board}, and the deadline is printed on your assessment notice (usually ${w.daysAfterNotice ?? 45} days or so from when it was mailed). Tell me the date on it and I'll put it on your deadlines.`,
      source: w.source,
    };
  }
  const status: Window["status"] =
    closesOn < today ? "closed" : opensOn && opensOn > today ? "upcoming" : "open";
  const text =
    status === "closed"
      ? `The window to appeal to ${board} closed on ${words(closesOn)}. The next one is after your next assessment notice.`
      : status === "upcoming"
        ? `Appeals to ${board} open on ${words(opensOn!)} and close on ${words(closesOn)}.`
        : `You can appeal to ${board} until ${words(closesOn)}.`;
  return { board, status, opensOn, closesOn, text, source: w.source };
}

export type OwnerFacts = {
  age: number | null;
  veteran: boolean | null;
  disabled: boolean | null;
  claimed: readonly string[];
};

// Exemptions the person may not have claimed: homestead for any owner who lives there, the
// others when their facts fit. A fact Jane doesn't have yet is asked rather than assumed.
export function exemptionsToClaim(
  state: string | null,
  facts: OwnerFacts,
): { eligible: Exemption[]; ask: string[] } {
  const all = (state && EXEMPTIONS[state]) || [];
  const eligible: Exemption[] = [];
  const ask = new Set<string>();
  for (const e of all) {
    if (facts.claimed.includes(e.key)) continue;
    // The facts in order; a known "no" ends it, an unknown one is asked about.
    const checks: [boolean | null, string][] = [
      [
        e.needs.minAge === undefined
          ? true
          : facts.age === null
            ? null
            : facts.age >= e.needs.minAge,
        "your age",
      ],
      [e.needs.veteran ? facts.veteran : true, "whether you served in the military"],
      [e.needs.disabled ? facts.disabled : true, "whether you have a service-connected disability"],
    ];
    let ok = true;
    for (const [value, question] of checks) {
      if (value === false) {
        ok = false;
        break;
      }
      if (value === null) {
        ask.add(question);
        ok = false;
      }
    }
    if (ok) eligible.push(e);
  }
  return { eligible, ask: [...ask] };
}

export function indicatedValue(comps: readonly Comparable[]): number {
  if (comps.length === 0) return 0;
  const sorted = comps.map((c) => c.adjustedCents).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function draftAppeal(input: {
  year: number;
  board: string;
  address: string;
  assessedCents: number;
  comps: readonly Comparable[];
}): string {
  const value = indicatedValue(input.comps);
  const rows = input.comps
    .map(
      (c) =>
        `  - ${c.address}: sold ${c.soldOn} for ${dollars(c.priceCents)} (${c.squareFeet.toLocaleString("en-US")} sq ft), ${dollars(c.adjustedCents)} for a home of the same size`,
    )
    .join("\n");
  return [
    `To: ${input.board}`,
    `Re: Appeal of the ${input.year} assessment of ${input.address}`,
    "",
    `I own the home at ${input.address}. The county assessed it at ${dollars(input.assessedCents)}. I believe its market value is lower, and I ask that the assessment be reduced to ${dollars(value)}.`,
    "",
    `Recent sales of comparable homes nearby:`,
    rows,
    "",
    `Brought to the size of my home, these sales indicate a value of ${dollars(value)} (the middle of the ${input.comps.length}). I would be glad to provide the sales records, and to appear at a hearing.`,
    "",
    "Sincerely,",
    "[Your name]",
  ].join("\n");
}

export const money = dollars;
