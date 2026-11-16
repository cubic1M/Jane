import { categoryOf } from "@/categorize/taxonomy";
import type { InsightTransaction } from "@/insights/spending";
import { oneOffCharges, withoutOneOffs } from "@/insights/typical-month";
import { confidenceOf, counted, type Source } from "@/profile/confidence";
import { spendingMonthOf } from "@/planning/idle-cash";
import { monthsForRate, type Fact, type ProfileInput, type ProfileTx } from "@/profile/build";
import { HEADLINE_MAX, SHORT_MAX, type Confidence, type WorthKind } from "./contract";
import { withoutAchDetails } from "@/data-sources/merchant";
import { formatCents, formatWholeDollars } from "@/lib/money";

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

// A payee as a person would say it: "NETFLIX.COM" is Netflix, "DISNEY PLUS" is Disney Plus,
// "VERIZON WIRELESS DES:PAYMENTREC ID:XXXXX" is Verizon Wireless.
export function nice(description: string): string {
  return (
    withoutAchDetails(description)
      // A customer-service number and the state after it ("COMCAST XFINITY 800-266-2278",
      // "DISNEY PLUS 888-905-7888 CA"; night QA 10-30).
      .replace(/\s+\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?:\s+[A-Z]{2})?\s*$/, "")
      // Or a toll-free one spelled in letters, and the state after it ("COMCAST CABLE COMM
      // 800-COMCAST PA": a student's bill read "Comcast Cable Comm 800-Comcast Pa", 11-15).
      .replace(/\s+8(?:00|33|44|55|66|77|88)-[A-Z]{4,}[A-Z0-9]*(?:\s+[A-Z]{2})?\s*$/, "")
      .replace(/\.com$/i, "")
      .replace(/\*.*$/, "")
      .trim()
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
  );
}

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
