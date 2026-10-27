import { categoryOf } from "@/categorize/taxonomy";
import type { InsightTransaction } from "@/insights/spending";
import { oneOffCharges, withoutOneOffs } from "@/insights/typical-month";
import { confidenceOf, counted, type Source } from "@/profile/confidence";
import type { Fact, ProfileInput, ProfileTx } from "@/profile/build";
import { HEADLINE_MAX, SHORT_MAX, type Confidence, type WorthKind } from "./contract";
import { formatWholeDollars } from "@/lib/money";

// What detectors share. Pure.

export const tx = (data: ProfileInput, f: (t: ProfileTx) => boolean) => data.transactions.filter(f);
export const outCents = (list: readonly ProfileTx[]) =>
  list.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);

// Books QA: the person's one-off costs (a flood's repairs), found once per profile and left out
// of the typical month (src/insights/typical-month.ts).
const oneOffCache = new WeakMap<readonly ProfileTx[], Set<ProfileTx>>();
export function oneOffsOf(data: ProfileInput): Set<ProfileTx> {
  const cached = oneOffCache.get(data.transactions);
  if (cached) return cached;
  const rows = data.transactions.map((t) => ({
    date: t.date,
    amountCents: t.amountCents,
    description: t.description,
    merchantName: null,
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
// Jane's) and one-off costs.
export function monthlySpendCents(data: ProfileInput, months: number): number {
  const oneOffs = oneOffsOf(data);
  const spent = tx(
    data,
    (t) =>
      t.amountCents > 0 &&
      !oneOffs.has(t) &&
      !(t.pfc ?? "").startsWith("TRANSFER") &&
      t.pfc !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  ).reduce((s, t) => s + t.amountCents, 0);
  return months > 0 ? Math.round(spent / months) : 0;
}

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

// A payee as a person would say it: "NETFLIX.COM" is Netflix, "DISNEY PLUS" is Disney Plus.
export function nice(description: string): string {
  return description
    .replace(/\.com$/i, "")
    .replace(/\*.*$/, "")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// "Netflix, Hulu and Disney Plus".
export function listOf(names: readonly string[]): string {
  const n = names.map(nice);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

// A headline: the verb phrase, then what it is worth ("Cancel Hulu, save $216 a year").
// `once` is for a one-off amount rather than a yearly one. Without a value, the phrase alone.
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
