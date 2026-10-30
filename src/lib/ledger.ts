import type { PrismaClient } from "@/generated/prisma/client";
import type { DetectionInput } from "@/detection/types";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { dayLabel } from "@/lib/day-label";
import { asWatch, outcomeYearly } from "@/planning/outcomes";
import { HELD_RULE, verifyRule, type LedgerState } from "@/planning/ledger";
import { verifiedSavings, type Receipt } from "@/lib/savings-proof";

// The savings ledger: every finding the person saw, in one of four states (src/planning/ledger.ts),
// with the transaction lines that prove it. It reads the verified savings record that already
// exists (src/lib/outcomes.ts for the person's own fixes, src/lib/savings-proof.ts for Jane's
// finished work) and adds what Jane found that nobody acted on yet. "Saved" counts Verified and
// Held only; estimates are summed apart and always called estimates.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export type LedgerLine = { id: string; date: string; description: string; amountCents: number };

export type LedgerEntry = {
  key: string;
  // "you": the person's own fix (a suggestion or a finding card); "jane": Jane's finished work.
  by: "you" | "jane";
  title: string;
  state: LedgerState;
  // Verified or Held: what the transactions show; otherwise Jane's estimate.
  cents: number;
  yearly: boolean;
  // How sure Jane was when it found it (null for Jane's own work, already done).
  confidencePercent: number | null;
  // How sure the check is that the transactions show it.
  verifiedPercent: number | null;
  rule: string;
  proof: string | null;
  lines: LedgerLine[];
  // Held, or came back: the lines that show it.
  heldProof: string | null;
  heldLines: LedgerLine[];
  lapsed: boolean;
  // Done and waiting: when it will be checked ("we'll check on Nov 5").
  checkWords: string | null;
  foundOn: string | null;
  actedOn: string | null;
  verifiedOn: string | null;
  heldOn: string | null;
  // Where the person does it (the suggestion's own page), while it's still theirs to do: said
  // yes or found (manager decision 10-30: the "here's where to do it" link was only in a chat
  // message suggestions never show in).
  href: string | null;
};

export type Ledger = {
  entries: LedgerEntry[];
  // The headline: Verified plus Held.
  savedCents: number;
  heldCents: number;
  // Estimates, apart: found and not acted on, and done but not shown yet.
  estimatedCents: number;
  saidYesCents: number;
  doneCents: number;
  counts: Record<LedgerState, number>;
};

const RECEIPT_RULE: Record<Receipt["kind"], string> = {
  refund: verifyRule({ kind: "refund", payees: [] }),
  lower_bill: verifyRule({ kind: "bill_drops", payees: [] }),
  switched: "Verified when the new company's first bill comes in.",
  cancelled: verifyRule({ kind: "charge_stops", payees: [] }),
};

const orderOf: Record<LedgerState, number> = {
  held: 0,
  verified: 1,
  done: 2,
  said_yes: 3,
  estimated: 4,
  not_seen: 5,
};

export async function savingsLedger(userId: string, options: Options = {}): Promise<Ledger> {
  const client = options.client ?? defaultClient;
  const db = scopedFor(userId, client);
  const [all, shown, live, pages] = await Promise.all([
    verifiedSavings(userId, options),
    db.suggestionOutcomes.findMany({
      where: { status: "shown", worthKind: "saves", expectedCents: { gt: 0 } },
      orderBy: [{ expectedCents: "desc" }, { id: "asc" }],
    }),
    db.suggestions.findMany({
      where: { status: { notIn: ["gone", "yes", "no"] } },
      select: { key: true, title: true, worthCents: true, confidencePercent: true, watch: true },
    }),
    db.suggestions.findMany({ select: { key: true, actionHref: true } }),
  ]);
  const pageOf = new Map(pages.map((p) => [p.key, p.actionHref]));
  const hrefOf = (key: string, state: LedgerState) =>
    state === "said_yes" || state === "estimated" ? (pageOf.get(key) ?? null) : null;
  // What each suggestion says now: a later scan moves its figure without showing it again
  // (debugger 10-30: fees "about $56/yr" here, from before the card's annual fee came in, while
  // the dock said $381).
  const stillFound = new Map(live.map((s) => [s.key, s]));
  const entries: LedgerEntry[] = [];

  // Jane's finished work: Verified or Held from its receipt; otherwise done or not seen.
  for (const r of all.actions.confirmed) {
    entries.push({
      key: `action:${r.actionId}`,
      by: "jane",
      title: r.title,
      state: r.heldOn ? "held" : "verified",
      cents: r.cents,
      yearly: r.yearly,
      confidencePercent: null,
      verifiedPercent: null,
      rule: RECEIPT_RULE[r.kind],
      proof: r.proof,
      lines: [{ id: `${r.actionId}:seen`, ...r.seen }],
      heldProof: r.heldOn ? `Still true on ${dayLabel(r.heldOn, { year: true })}.` : null,
      heldLines: [],
      lapsed: false,
      checkWords: null,
      foundOn: null,
      actedOn: null,
      verifiedOn: r.verifiedOn,
      heldOn: r.heldOn,
      href: null,
    });
  }
  const plain = (e: { actionId: string; title: string; cents: number; why: string }) => ({
    key: `action:${e.actionId}`,
    by: "jane" as const,
    title: e.title,
    cents: e.cents,
    yearly: true,
    confidencePercent: null,
    verifiedPercent: null,
    rule: e.why,
    proof: null,
    lines: [],
    heldProof: null,
    heldLines: [],
    lapsed: false,
    checkWords: null,
    foundOn: null,
    actedOn: null,
    verifiedOn: null,
    heldOn: null,
    href: null,
  });
  for (const e of all.actions.estimated) entries.push({ ...plain(e), state: "done" });
  for (const e of all.actions.notShown) entries.push({ ...plain(e), state: "not_seen" });

  // The person's own fixes, as the record keeps them.
  const s = all.suggestions;
  for (const o of [...s.confirmed, ...s.expected, ...s.notSeen]) {
    const counted = o.state === "verified" || o.state === "held";
    entries.push({
      key: o.key,
      by: "you",
      title: o.title,
      state: o.state,
      cents: counted ? (o.confirmedCents ?? 0) : o.expectedCents,
      yearly: o.yearly,
      confidencePercent: o.confidencePercent || null,
      verifiedPercent: o.verifiedPercent,
      rule: o.state === "verified" ? `${o.rule} ${HELD_RULE}` : o.rule,
      proof: o.proof,
      lines: o.evidence,
      heldProof: o.heldProof,
      heldLines: o.heldEvidence,
      lapsed: o.lapsed,
      checkWords: o.checkWords,
      foundOn: o.foundOn,
      actedOn: o.actedOn,
      verifiedOn: o.verifiedOn,
      heldOn: o.heldOn,
      href: hrefOf(o.key, o.state),
    });
  }

  // Found and not acted on: still on offer.
  for (const o of shown) {
    const now = stillFound.get(o.suggestionKey);
    if (!now || now.worthCents <= 0) continue;
    entries.push({
      key: o.suggestionKey,
      by: "you",
      title: now.title,
      state: "estimated",
      cents: now.worthCents,
      yearly: outcomeYearly(now.watch ?? o.watch, true),
      confidencePercent: now.confidencePercent || null,
      verifiedPercent: null,
      rule: verifyRule(asWatch(now.watch) ?? asWatch(o.watch)),
      proof: null,
      lines: [],
      heldProof: null,
      heldLines: [],
      lapsed: false,
      checkWords: null,
      foundOn: o.firstShownAt.toISOString().slice(0, 10),
      actedOn: null,
      verifiedOn: null,
      heldOn: null,
      href: pageOf.get(o.suggestionKey) ?? null,
    });
  }

  entries.sort((a, b) => orderOf[a.state] - orderOf[b.state] || b.cents - a.cents);
  const sum = (states: LedgerState[]) =>
    entries.filter((e) => states.includes(e.state)).reduce((t, e) => t + e.cents, 0);
  const counts = { estimated: 0, said_yes: 0, done: 0, verified: 0, held: 0, not_seen: 0 };
  for (const e of entries) counts[e.state] += 1;
  return {
    entries,
    // The same verified figure every other place shows (/saved, Home, the share link).
    savedCents: all.confirmedCents,
    heldCents: sum(["held"]),
    estimatedCents: sum(["estimated"]),
    saidYesCents: sum(["said_yes"]),
    doneCents: sum(["done"]),
    counts,
  };
}

// The entries whose state moved inside a month (YYYY-MM): what was done, verified, held.
export function inMonth(
  entry: LedgerEntry,
  month: string,
  field: "actedOn" | "verifiedOn" | "heldOn",
) {
  return entry[field]?.slice(0, 7) === month;
}
