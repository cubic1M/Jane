import { categoryOf } from "@/categorize/taxonomy";
import type { InsightTransaction } from "@/insights/spending";
import { oneOffCharges, withoutOneOffs } from "@/insights/typical-month";
import { confidenceOf, counted, type Source } from "@/profile/confidence";
import { spendingMonthOf } from "@/planning/idle-cash";
import {
  monthsForRate,
  rateMonthsOf,
  type Fact,
  type Profile,
  type ProfileInput,
  type ProfileTx,
} from "@/profile/build";
import { DETECTOR_RATES } from "@/config/detectors";
import { studentYearOf } from "@/planning/student-tax";
import { HEADLINE_MAX, SHORT_MAX, type Confidence, type WorthKind } from "./contract";
import { withoutAchDetails, withoutAchEntry } from "@/data-sources/merchant";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { STALE_UPLOAD_DAYS } from "@/config/import";
import { daysBetween } from "@/lib/dates";

// What detectors share. Pure.

export const tx = (data: Pick<ProfileInput, "transactions">, f: (t: ProfileTx) => boolean) =>
  data.transactions.filter(f);
export const outCents = (list: readonly ProfileTx[]) =>
  list.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);

// The rows and day a monthly spending figure is read from: a profile, or anything shaped like one.
type Spending = Pick<ProfileInput, "transactions" | "today">;

// Books QA: the person's one-off costs (a flood's repairs), found once per profile and left out
// of the typical month (src/insights/typical-month.ts).
const oneOffCache = new WeakMap<readonly ProfileTx[], Set<ProfileTx>>();
function oneOffsOf(data: Spending): Set<ProfileTx> {
  const cached = oneOffCache.get(data.transactions);
  if (cached) return cached;
  const rows = data.transactions.map((t) => ({
    date: t.date,
    amountCents: t.amountCents,
    description: t.description,
    merchantName: t.merchantName ?? null,
    pfcPrimary: t.pfc ? (categoryOf(t.pfc)?.primary ?? null) : null,
    pfcDetailed: t.pfc,
    pending: false,
    source: t,
  })) satisfies (InsightTransaction & { source: ProfileTx })[];
  const kept = new Set(withoutOneOffs(rows, oneOffCharges(rows, data.today)).map((r) => r.source));
  const found = new Set(data.transactions.filter((t) => !kept.has(t)));
  oneOffCache.set(data.transactions, found);
  return found;
}

// Everything spent in a typical month, on average: money out except transfers (which stay
// Jane's) and one-off costs. Spread over the real span of a short history, as income is
// (monthsForRate): the calendar count made Aug 1 to Oct 26 "2 months", and a freelancer's
// spending read 40% high beside their income (night QA 10-30: a $51,771 cushion).
export function monthlySpendCents(data: Spending, months: number): number {
  const oneOffs = oneOffsOf(data);
  const spent = tx(
    data,
    (t) =>
      t.amountCents > 0 &&
      !oneOffs.has(t) &&
      !(t.pfc ?? "").startsWith("TRANSFER") &&
      t.pfc !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  ).reduce((s, t) => s + t.amountCents, 0);
  if (months <= 0) return 0;
  return Math.round(spent / monthsForRate(data.transactions, data.today));
}

// A month of spending, the one the emergency fund is sized from everywhere: the cushion card, the
// idle cash card and finding, the chat's cushion answers, the goal Jane drafts, the refund plan and
// the cash page (src/lib/cushion-spend.ts) all read spendingMonthOf (src/planning/idle-cash.ts), so
// they name one figure (night QA 10-30: "a cushion for you is $11,604.78" beside an "Emergency
// fund" goal of 3 months at $2,151.16; gate B, 11-16: one dock said "spend about $1,423.98 a
// month" on its idle cash card and $1,273.14 on its emergency goal, the typical calendar month to
// today against idle cash's days to where an old statement ends).
export const cushionSpendCents = (data: Spending): number =>
  spendingMonthOf({ asOf: data.today, transactions: data.transactions }).monthlyCents;

export const liquidCents = (data: ProfileInput) =>
  data.accounts.filter((a) => a.type === "depository").reduce((s, a) => s + a.balanceCents, 0);

// Whether any checking or savings balance is known. Uploaded files often carry none, and an
// unknown balance is not an empty account: "your cash is low" needs a real figure.
export const cashKnown = (data: ProfileInput) =>
  data.accounts.some((a) => a.type === "depository" && a.balanceKnown !== false);

// One piece of evidence as a percentage and its reason: `matches` of `what` seen over
// `months` months of data, known how (seen, told or guessed).
export function evidence(
  source: Source,
  months: number,
  matches: number,
  what: string,
): Confidence {
  const percent = confidenceOf(source, { months, matches });
  if (source === "told") return { percent, reason: "you told me" };
  const span = `${months} month${months === 1 ? "" : "s"} of data`;
  return {
    percent,
    reason: matches > 0 ? `${counted(matches, what)} in ${span}` : `no ${what} in ${span}`,
  };
}

// A profile fact as a piece of evidence.
export const factEvidence = (fact: Fact): Confidence => ({
  percent: fact.confidence,
  reason: fact.evidence,
});

// The suggestion's confidence: the weakest piece of evidence it rests on, so it is never
// surer than the least certain fact or count behind it (spec step 254). Same evidence, same
// percentage, always.
export function weakest(parts: readonly Confidence[]): Confidence {
  return parts.reduce((a, b) => (b.percent < a.percent ? b : a));
}

// What the person's cash is, said so a negative balance reads as overdrawn (night QA 10-30: "You
// keep -$278.80 in cash"). `verb`: "keep" or "hold", as the sentence around it has it.
export function cashLine(cents: number, verb: "keep" | "hold" = "keep"): string {
  return cents < 0
    ? `You're ${formatCents(-cents)} overdrawn`
    : `You ${verb} ${formatCents(cents)} in cash`;
}

// Statements whose newest line is too old to say what's paid or held now, by the report's rule
// (STALE_UPLOAD_DAYS, the report's "Your statements end …"): a card about now waits for newer ones
// (debugger 11-18: "You pay Xfinity about $55.00 a month" and "You keep $1,950.16 in cash" from
// statements that ended Sep 28, under a report that said it was too long ago to tell).
export function statementsTooOld(data: Pick<ProfileInput, "transactions" | "today">): boolean {
  const newest = data.transactions.reduce<string | null>(
    (m, t) => (t.date <= data.today && (m === null || t.date > m) ? t.date : m),
    null,
  );
  return newest !== null && daysBetween(newest, data.today) > STALE_UPLOAD_DAYS;
}

// A payee as a person would say it: "NETFLIX.COM" is Netflix, "DISNEY PLUS" is Disney Plus,
// "VERIZON WIRELESS DES:PAYMENTREC ID:XXXXX" is Verizon Wireless.
export function nice(description: string): string {
  const line = withoutAchDetails(description)
    // An ACH entry's code and company ID, as the merchant names leave them out ("GEICO AUTO PPD
    // ID: 3334445556" read "Geico Auto Ppd Id:" on a car cover card; debugger 11-18).
    .replace(/\s+\b(?:PPD|WEB|CCD|TEL)\s+ID:?\s*\S*/g, "")
    // A customer-service number and the state after it ("COMCAST XFINITY 800-266-2278",
    // "DISNEY PLUS 888-905-7888 CA"; night QA 10-30).
    .replace(/\s+\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?:\s+[A-Z]{2})?\s*$/, "")
    // Or a toll-free one spelled in letters, and the state after it ("COMCAST CABLE COMM
    // 800-COMCAST PA": a student's bill read "Comcast Cable Comm 800-Comcast Pa", 11-15).
    .replace(/\s+8(?:00|33|44|55|66|77|88)-[A-Z]{4,}[A-Z0-9]*(?:\s+[A-Z]{2})?\s*$/, "")
    .replace(/\.com$/i, "")
    .replace(/\*.*$/, "")
    // A store or terminal number at the end ("TARGET 00012345", "TRADER JOE S #123"), as the
    // merchant names leave it out (debug 3, 11-19: "Target 00012345 $64.20 was charged twice.").
    // Four digits or fewer without a "#" can be the name's own ("7-Eleven 2045" is kept).
    .replace(/\s+(?:#\d+|\d{5,})$/, "")
    .trim();
  // And the entry's word for what it is ("T-MOBILE AUTO PAY" read "T-Mobile Auto Pay" on a bill
  // card; debugger 11-18), as the merchant names leave it out.
  return withoutAchEntry(line)
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// A charge as the cards name it: Jane's cleaned name for the merchant where the charge has one,
// else its line made readable (debug 3, 11-19: "Target 00012345" from the bank's line; debug 2,
// 11-19: "You paid rent to Zelle Payment To Jordan P" beside Bills' "Jordan P").
export const nameOf = (t: Pick<ProfileTx, "merchantName" | "description">) =>
  t.merchantName ?? nice(t.description);

// "Netflix, Hulu and Disney Plus".
export function listOf(names: readonly string[]): string {
  const n = names.map(nice);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

// A headline: the verb phrase, then what it is worth ("Cancel Hulu, save $216 a year").
// `once` is for a one-off amount rather than a yearly one. Without a value, the phrase alone.
// What the report's open findings of `type` are worth a year, added up: the figure a suggestion on
// the same topic says, so the dock and the report never price one thing twice (gate B: a price
// rise read $156 a year on the report and $174 in the dock, a trial $13.99 and $168 a year). Null
// when the report has none, or none with a figure: the detector's own is then the only one shown.
export function reportsWorth(data: Pick<ProfileInput, "findings">, type: string): number | null {
  const worths = (data.findings ?? [])
    .filter((f) => f.type === type && f.annualSavingsCents !== null)
    .map((f) => f.annualSavingsCents!);
  return worths.length === 0 ? null : worths.reduce((s, c) => s + c, 0);
}

export function headlineOf(
  phrase: string,
  worthCents: number,
  kind: WorthKind,
  once = false,
): string {
  if (worthCents <= 0) return phrase;
  const d = formatWholeDollars(worthCents);
  const worth =
    kind === "risk"
      ? `avoid up to ${d}`
      : kind === "earns"
        ? once
          ? `get ${d} back`
          : `earn ${d} a year`
        : once
          ? `save ${d}`
          : `save ${d} a year`;
  return `${phrase}, ${worth}`;
}

// A line cut at a word boundary to fit, for the parts that are a list of the person's own
// things (their payees, their accounts) and so have no fixed length.
export function clip(text: string, max = SHORT_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
}

// The short forms of a strategist idea (step 256), whose title and why are written by the
// model: the title, cut to a headline, and the first sentence of the why.
export function ideaShortForms(title: string, why: string): { headline: string; short: string } {
  const firstSentence = why.split(/(?<=[.!?])\s/)[0];
  return {
    headline: clip(title.replace(/[.!?]+$/, ""), HEADLINE_MAX),
    short: clip(firstSentence),
  };
}

// How sure Jane is of a fund's cost, from where the figure came from (src/config/funds.ts): read
// from the fund's own filing and recent, the fund company's published figure not yet checked
// against the filing, or the demo table's made-up one. The weakest of the funds counts.
export function feeEvidence(
  facts: readonly { source: string; asOf?: string }[],
  today: string,
): Confidence {
  const demo = facts.some((f) => /^Demo fund facts/.test(f.source));
  if (demo) return { percent: 70, reason: "fund costs from Jane's demo fund table" };
  const dated = facts.every((f) => f.asOf);
  if (dated) {
    const oldest = facts.map((f) => f.asOf!).sort()[0];
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000;
    return age <= 400
      ? { percent: 92, reason: `expense ratios from the funds' filings, as of ${oldest}` }
      : {
          percent: 80,
          reason: `expense ratios from the funds' filings, as of ${oldest} (over a year old)`,
        };
  }
  return { percent: 80, reason: "the fund companies' published expense ratios, rounded" };
}

// A year's income before tax, one figure on every income-tested card: pay grossed up, gig pay and
// fellowship money as the tax credits estimate it (studentYearOf); what the person told Jane wins,
// and with none of that seen (a pension), the profile's monthly income grossed up. Debug 2, uploads
// S6 and the 14-month Plaid person, 11-19: "income near $27,444.46" on the Saver's Credit beside
// "$18,744.80" on the renter's credit, then Lifeline's "$21,204.46" beside "$21,530.03".
//
// A card for a tax year that has ended (the 2026 Saver's Credit, read in January 2027) reads that
// year's own pay: its figure doesn't move when the calendar turns (gate C's sweep, 1-1: the renter's
// year went from 2026's pay to 2027's month as a year overnight). Say which year it is with
// incomeYearOf.
export function yearIncomeOf(
  profile: Pick<Profile, "facts" | "months" | "rateMonths">,
  data: Pick<ProfileInput, "transactions" | "today">,
  taxYear?: number,
): number {
  const income = profile.facts.monthly_income;
  const asOf =
    incomeYearOf(data, taxYear) < Number(data.today.slice(0, 4))
      ? { ...data, today: `${taxYear}-12-31` }
      : data;
  const year =
    income.source === "told"
      ? 0
      : studentYearOf(asOf, profile.facts, rateMonthsOf(profile)).agiCents;
  if (year > 0) return year;
  return typeof income.value === "number" && income.value > 0
    ? Math.round(income.value * 12 * DETECTOR_RATES.tax.netToGross)
    : 0;
}

// The year yearIncomeOf's figure is for: the tax year asked, when it has ended, or this one. Every
// "income near" says it ("2026 income near $X"), so a new year's figure isn't read as the same year's
// dropping overnight.
export function incomeYearOf(data: Pick<ProfileInput, "today">, taxYear?: number): number {
  const now = Number(data.today.slice(0, 4));
  return taxYear !== undefined && taxYear < now ? taxYear : now;
}
