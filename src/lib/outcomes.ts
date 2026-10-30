import { CHECK_LOOKBACK_DAYS, HELD_DAYS, WATCH_DAYS } from "@/config/outcomes";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import type { Watch } from "@/detectors/contract";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { logAudit, SYSTEM_ACTOR, type AuditActor } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkWords, ledgerStateOf, verifyRule, type LedgerState } from "@/planning/ledger";
import {
  asWatch,
  checkHeld,
  checksOn,
  verifyWatch,
  watchOfFinding,
  type Check,
  type Coverage,
  type OutcomeTx,
} from "@/planning/outcomes";
import {
  isHoldingsWatch,
  verifyHoldingsWatch,
  type HoldingsNow,
} from "@/planning/outcomes-holdings";
import { addDays, DAY_MS, isoDay as isoDate } from "@/lib/dates";

// The verified savings record: what happened to each suggestion that reached the person (shown,
// opened, answered, marked done) and what their later transactions showed. A saving counts as
// confirmed only when the transactions show it (a charge that stopped, a lower bill, a refund,
// fees that stopped), with those transactions kept as the evidence; until then it's an
// expectation, shown apart. The nightly run checks what's open (verifyOutcomes).

type Options = { client?: PrismaClient; now?: Date };

const jsonOf = (watch: Watch | null | undefined) =>
  watch ? (watch as unknown as Prisma.InputJsonObject) : Prisma.DbNull;

// Statuses that are still checked each night (partial and not seen can still turn into more).
const CHECKED = ["open", "partial", "not_seen"];
// Verified: checked each night until Held, or until it came back (lapsed).
const VERIFIED = ["confirmed", "partial"];
// Statuses after a yes or a done.
const ACTED = ["open", "partial", "not_seen", "confirmed", "unverifiable", "lapsed"];

// Every move between the ledger's states goes to the audit log (src/planning/ledger.ts).
async function auditState(
  actor: AuditActor,
  row: { id: string; suggestionKey: string; status: string; heldAt?: Date | null },
  next: { status: string; heldAt?: Date | null },
  cents: number,
): Promise<void> {
  const from = ledgerStateOf(row);
  const to = ledgerStateOf({ heldAt: row.heldAt, ...next });
  if (from === to || to === null) return;
  await logAudit(
    actor,
    "saving_state_changed",
    { type: "suggestion_outcome", id: row.id },
    { key: row.suggestionKey, from, to, cents },
  );
}

// How far each account's statements reach (YYYY-MM-DD, never past today): its newest
// transaction, its newest upload's last day, its bank's last sync. A charge that "stopped" is
// only seen up to there.
export async function statementCoverage(
  userId: string,
  input: Pick<DetectionInput, "transactions">,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Coverage> {
  const db = scopedFor(userId, client);
  const [runs, accounts] = await Promise.all([
    db.importRuns.findMany({
      where: { kind: "upload", accountId: { not: null }, toDate: { not: null } },
      select: { accountId: true, toDate: true },
    }),
    db.accounts.findMany({ select: { id: true, item: { select: { lastSyncedAt: true } } } }),
  ]);
  const today = isoDate(now);
  const out: Record<string, string> = {};
  const reach = (id: string, day: string) => {
    const capped = day > today ? today : day;
    if (!out[id] || capped > out[id]) out[id] = capped;
  };
  for (const t of input.transactions) reach(t.accountId, t.date);
  for (const r of runs) reach(r.accountId!, isoDate(r.toDate!));
  for (const a of accounts) if (a.item?.lastSyncedAt) reach(a.id, isoDate(a.item.lastSyncedAt));
  return out;
}

export type ShownSuggestion = {
  key: string;
  capability: string;
  topic: string;
  title: string;
  worthCents: number;
  worthKind: string;
  confidencePercent: number;
  watch?: Watch | null;
};

// The day's suggestions reached the person: a row each, or one more showing of it.
export async function recordShown(
  userId: string,
  shown: readonly ShownSuggestion[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (shown.length === 0) return;
  const db = scopedFor(userId, client);
  const have = new Map(
    (
      await db.suggestionOutcomes.findMany({
        where: { suggestionKey: { in: shown.map((s) => s.key) } },
        select: { id: true, suggestionKey: true, status: true },
      })
    ).map((o) => [o.suggestionKey, o]),
  );
  for (const s of shown) {
    const about = {
      capability: s.capability,
      topic: s.topic,
      title: s.title,
      expectedCents: s.worthCents,
      worthKind: s.worthKind,
      confidencePercent: s.confidencePercent,
      watch: jsonOf(s.watch),
    };
    const row = have.get(s.key);
    if (!row) {
      await db.suggestionOutcomes.create({
        data: { userId, suggestionKey: s.key, firstShownAt: now, lastShownAt: now, ...about },
      });
    } else {
      // Not answered yet: what it says now. Answered: only that it was shown again.
      await db.suggestionOutcomes.updateMany({
        where: { id: row.id },
        data: {
          lastShownAt: now,
          timesShown: { increment: 1 },
          ...(row.status === "shown" ? about : {}),
        },
      });
    }
  }
}

// What the outcome row needs from the suggestion itself, for an answer or a done that comes
// without a showing on record (answered from an older message).
async function ensureOutcome(userId: string, key: string, client: PrismaClient, now: Date) {
  const db = scopedFor(userId, client);
  const outcome = await db.suggestionOutcomes.findFirst({ where: { suggestionKey: key } });
  const suggestion = await db.suggestions.findFirst({ where: { key } });
  if (!outcome && !suggestion) return null;
  if (!outcome) {
    return db.suggestionOutcomes.create({
      data: {
        userId,
        suggestionKey: key,
        capability: suggestion!.capability,
        topic: suggestion!.topic,
        title: suggestion!.title,
        firstShownAt: now,
        lastShownAt: now,
        expectedCents: suggestion!.worthCents,
        worthKind: suggestion!.worthKind,
        confidencePercent: suggestion!.confidencePercent,
        watch: jsonOf(asWatch(suggestion!.watch)),
      },
    });
  }
  // The suggestion's freshest watch when the row has none (shown before watches existed).
  if (!asWatch(outcome.watch) && suggestion && asWatch(suggestion.watch)) {
    await db.suggestionOutcomes.updateMany({
      where: { id: outcome.id },
      data: { watch: jsonOf(asWatch(suggestion.watch)) },
    });
    return { ...outcome, watch: suggestion.watch };
  }
  return outcome;
}

// "Why?" or More details on a suggestion: the first time is kept.
export async function recordOpened(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).suggestionOutcomes.updateMany({
    where: { suggestionKey: key, openedAt: null },
    data: { openedAt: now },
  });
}

// A yes or a no. A yes with something to watch is checked from then on; one without stays an
// expectation (unverifiable).
export async function recordAnswer(
  userId: string,
  key: string,
  answer: "yes" | "no",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const outcome = await ensureOutcome(userId, key, client, now);
  if (!outcome || outcome.status === "confirmed") return;
  const status = answer === "no" ? "declined" : asWatch(outcome.watch) ? "open" : "unverifiable";
  await scopedFor(userId, client).suggestionOutcomes.updateMany({
    where: { id: outcome.id },
    data: { answer, answeredAt: now, status },
  });
  await auditState({ type: "user", id: userId }, outcome, { status }, outcome.expectedCents);
}

export class OutcomeError extends Error {}

// The person did it themselves ("Mark done"): checked from today.
export async function markSuggestionDone(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ status: string }> {
  const outcome = await ensureOutcome(userId, key, client, now);
  if (!outcome) throw new OutcomeError("That suggestion isn't there any more.");
  const status =
    outcome.status === "confirmed" || outcome.status === "partial"
      ? outcome.status
      : asWatch(outcome.watch)
        ? "open"
        : "unverifiable";
  await scopedFor(userId, client).suggestionOutcomes.updateMany({
    where: { id: outcome.id },
    data: {
      doneAt: outcome.doneAt ?? now,
      ...(outcome.answer ? {} : { answer: "yes", answeredAt: now }),
      status,
    },
  });
  await auditState({ type: "user", id: userId }, outcome, { status }, outcome.expectedCents);
  // The suggestion is answered for good: it isn't offered again.
  await scopedFor(userId, client).suggestions.updateMany({
    where: { key, status: { notIn: ["yes", "no"] } },
    data: { status: "yes", answeredAt: now },
  });
  return { status };
}

// The record's key for a finding card done by the person themselves.
export const FINDING_OUTCOME_PREFIX = "finding:";

// "Mark done" on a do-it-yourself finding card: on the record from today, watched from the
// finding's evidence. Once.
export async function recordFindingDone(
  userId: string,
  findingId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const finding = await db.findings.findFirst({
    where: { id: findingId },
    select: { type: true, title: true, evidence: true, annualSavingsCents: true },
  });
  if (!finding) return;
  const key = `${FINDING_OUTCOME_PREFIX}${findingId}`;
  if ((await db.suggestionOutcomes.count({ where: { suggestionKey: key } })) > 0) return;
  const watch = watchOfFinding(finding.type, finding.evidence);
  const row = await db.suggestionOutcomes.create({
    data: {
      userId,
      suggestionKey: key,
      capability: "finding",
      topic: finding.type,
      title: finding.title,
      firstShownAt: now,
      lastShownAt: now,
      answer: "yes",
      answeredAt: now,
      doneAt: now,
      expectedCents: finding.annualSavingsCents ?? 0,
      worthKind: "saves",
      confidencePercent: 0,
      watch: jsonOf(watch),
      status: watch ? "open" : "unverifiable",
    },
  });
  await auditState(
    { type: "user", id: userId },
    { ...row, status: "shown" },
    row,
    row.expectedCents,
  );
}

// What a person holds now, for the investing savings (src/planning/outcomes-holdings.ts).
async function loadHoldingsNow(userId: string, client: PrismaClient): Promise<HoldingsNow> {
  const db = scopedFor(userId, client);
  const [accounts, holdings] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
    }),
    db.holdings.findMany({
      select: {
        accountId: true,
        valueCents: true,
        security: { select: { ticker: true, isCashEquivalent: true, type: true } },
      },
    }),
  ]);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents ?? 0,
    })),
    holdings: holdings.map((h) => ({
      accountId: h.accountId,
      ticker: h.security.ticker,
      isCash: h.security.isCashEquivalent || h.security.type === "cash",
      valueCents: h.valueCents,
    })),
  };
}

// Each night: the open outcomes against the transactions (and, for investing, the holdings), and
// the verified ones for Held (still true HELD_DAYS later) or lapsed (it came back). Returns what
// changed.
export async function verifyOutcomes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input: given,
  }: Options & { input?: DetectionInput } = {},
): Promise<{ checked: number; confirmed: number; notSeen: number; held: number; lapsed: number }> {
  const db = scopedFor(userId, client);
  const open = await db.suggestionOutcomes.findMany({
    where: { status: { in: [...CHECKED, ...VERIFIED] }, heldAt: null },
  });
  const counts = { checked: open.length, confirmed: 0, notSeen: 0, held: 0, lapsed: 0 };
  if (open.length === 0) return counts;
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const txs: OutcomeTx[] = input.transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    description: t.description,
    pfc: t.pfcDetailed,
    accountId: t.accountId,
  }));
  const coveredThrough = await statementCoverage(userId, input, { client, now });
  const asOf = isoDate(now);
  let holdingsNow: HoldingsNow | null = null;
  const holdings = async () => (holdingsNow ??= await loadHoldingsNow(userId, client));
  const update = async (
    o: (typeof open)[number],
    data: Prisma.SuggestionOutcomeUpdateManyMutationInput & { status?: string },
    cents: number,
  ) => {
    await db.suggestionOutcomes.updateMany({ where: { id: o.id }, data });
    await auditState(
      SYSTEM_ACTOR,
      o,
      { status: data.status ?? o.status, heldAt: (data.heldAt as Date | undefined) ?? o.heldAt },
      cents,
    );
  };
  for (const o of open) {
    const watch = asWatch(o.watch);
    const started = o.doneAt ?? o.answeredAt;
    if (!watch || !started) {
      await update(o, { status: "unverifiable", checkedAt: now }, o.expectedCents);
      continue;
    }
    const startedOn = isoDate(started);

    // Verified: held, or came back? Investing, from what they hold once HELD_DAYS have passed.
    if (VERIFIED.includes(o.status) && o.verifiedAt) {
      const verifiedOn = isoDate(o.verifiedAt);
      let held:
        { status: "waiting" } | { status: "held" | "lapsed"; evidence: string[]; proof: string };
      if (isHoldingsWatch(watch)) {
        const due = now.getTime() - o.verifiedAt.getTime() >= HELD_DAYS * DAY_MS;
        const again = due
          ? verifyHoldingsWatch(
              watch,
              { startedOn, asOf, expectedCents: o.expectedCents },
              await holdings(),
            )
          : null;
        held =
          again === null || again.status === "waiting"
            ? { status: "waiting" }
            : again.status === "not_seen"
              ? { status: "lapsed", evidence: [], proof: again.proof }
              : { status: "held", evidence: [], proof: again.proof };
      } else {
        held = checkHeld(
          watch,
          {
            startedOn,
            verifiedOn,
            asOf,
            confirmedCents: o.confirmedCents ?? 0,
            coveredThrough,
          },
          txs,
        );
      }
      if (held.status === "held") {
        counts.held += 1;
        await update(
          o,
          { heldAt: now, heldProof: held.proof, heldEvidenceTxIds: held.evidence, checkedAt: now },
          o.confirmedCents ?? 0,
        );
        continue;
      }
      if (held.status === "lapsed") {
        counts.lapsed += 1;
        await update(
          o,
          {
            status: "lapsed",
            lapsedAt: now,
            heldProof: held.proof,
            heldEvidenceTxIds: held.evidence,
            checkedAt: now,
          },
          o.confirmedCents ?? 0,
        );
        continue;
      }
      // Confirmed waits for Held; partial can still grow.
      if (o.status === "confirmed") {
        await db.suggestionOutcomes.updateMany({ where: { id: o.id }, data: { checkedAt: now } });
        continue;
      }
    }

    // Long past its window (twice over): it stays as it is.
    if (now.getTime() - started.getTime() > 2 * WATCH_DAYS[watch.kind] * DAY_MS) continue;
    const about = { startedOn, asOf, expectedCents: o.expectedCents };
    // Investing savings show in what they hold now, not in their transactions.
    const check: Check = isHoldingsWatch(watch)
      ? verifyHoldingsWatch(watch, about, await holdings())
      : verifyWatch(watch, { ...about, coveredThrough }, txs);
    if (check.status === "waiting") {
      await db.suggestionOutcomes.updateMany({ where: { id: o.id }, data: { checkedAt: now } });
      continue;
    }
    if (check.status === "not_seen") {
      if (o.status !== "not_seen") counts.notSeen += 1;
      await update(
        o,
        { status: "not_seen", evidenceTxIds: check.evidence, proof: check.proof, checkedAt: now },
        o.expectedCents,
      );
      continue;
    }
    if (check.status === "confirmed" && o.status !== "confirmed") counts.confirmed += 1;
    await update(
      o,
      {
        status: check.status,
        confirmedCents: check.cents,
        yearly: check.yearly,
        verifiedPercent: check.percent,
        evidenceTxIds: check.evidence,
        proof: check.proof,
        checkedAt: now,
        verifiedAt: o.verifiedAt ?? now,
      },
      check.cents,
    );
  }
  return counts;
}

export type OutcomeView = {
  key: string;
  topic: string;
  title: string;
  status: string;
  expectedCents: number;
  confirmedCents: number | null;
  yearly: boolean;
  verifiedPercent: number | null;
  proof: string | null;
  evidence: { id: string; date: string; description: string; amountCents: number }[];
  actedOn: string | null;
  // Marked done (by the person), not just said yes to.
  markedDone: boolean;
  // The day the transactions first showed it.
  verifiedOn: string | null;
  // The ledger (src/planning/ledger.ts): its state, how sure Jane was when it found it, how it
  // is verified, and Held (or came back) with the lines that show it.
  state: LedgerState;
  // The day Jane first showed it.
  foundOn: string;
  confidencePercent: number;
  rule: string;
  heldOn: string | null;
  lapsed: boolean;
  heldProof: string | null;
  heldEvidence: { id: string; date: string; description: string; amountCents: number }[];
  // Done and waiting: the day it will be checked, and the words for it ("we'll check on Nov 5").
  checksOn: string | null;
  checkWords: string | null;
};

// Why an expected saving isn't counted yet, in the person's words: "You said yes" until they mark
// it done (QA round 11: it said "You did it" after a bare yes).
export function expectedWhy(
  o: Pick<OutcomeView, "status" | "actedOn" | "markedDone"> & { checkWords?: string | null },
): string {
  const did = o.markedDone ? "You did it" : "You said yes";
  if (o.status === "unverifiable") return `${did}; it isn't something your transactions can show.`;
  return `${did}${o.actedOn ? ` on ${o.actedOn}` : ""}. It counts once your transactions show it${o.checkWords ? `; ${o.checkWords}` : ""}.`;
}

export type SavingsRecord = {
  confirmed: OutcomeView[];
  // Said yes or done; not shown in the transactions yet (or nothing to watch).
  expected: OutcomeView[];
  notSeen: OutcomeView[];
  confirmedCents: number;
  expectedCents: number;
};

// The person's record, for /saved, the home tile and the monthly report.
export async function savingsRecord(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SavingsRecord> {
  const db = scopedFor(userId, client);
  const all = await db.suggestionOutcomes.findMany({
    where: { status: { in: ACTED } },
    orderBy: [{ verifiedAt: "asc" }, { answeredAt: "asc" }, { id: "asc" }],
  });
  const named = (r: (typeof all)[number]) => [...r.evidenceTxIds, ...r.heldEvidenceTxIds];
  const ids = [...new Set(all.flatMap(named))];
  const txs =
    ids.length > 0
      ? await db.transactions.findMany({
          where: { id: { in: ids } },
          select: { id: true, date: true, description: true, amountCents: true },
        })
      : [];
  const byId = new Map(txs.map((t) => [t.id, t]));
  // The evidence gate (src/lib/evidence/gate.ts), with the rows already read: a line whose named
  // transactions are all gone (a removed bank or upload) is never shown or counted, even before
  // removeOrphans deletes it.
  // Investing lines name holdings, not transactions: their accounts' removal deletes them.
  const rows = all.filter((r) => {
    const watch = asWatch(r.watch);
    if (watch && isHoldingsWatch(watch)) return true;
    return named(r).length === 0 || named(r).some((id) => byId.has(id));
  });
  const lines = (txIds: string[]) =>
    txIds.flatMap((id) => {
      const t = byId.get(id);
      return t
        ? [{ id, date: isoDate(t.date), description: t.description, amountCents: t.amountCents }]
        : [];
    });
  // Done and waiting on a charge or a bill: when it will be checked, from the charges before.
  const waiting = rows.filter((r) => r.status === "open" && (r.doneAt ?? r.answeredAt));
  const startOf = (r: (typeof rows)[number]) => isoDate((r.doneAt ?? r.answeredAt)!);
  const needCharges = waiting.some((r) => {
    const w = asWatch(r.watch);
    return w?.kind === "charge_stops" || w?.kind === "bill_drops";
  });
  const charges: OutcomeTx[] = needCharges
    ? (
        await db.transactions.findMany({
          where: {
            amountCents: { gt: 0 },
            pending: false,
            date: {
              gte: new Date(
                `${addDays(waiting.map(startOf).sort()[0], -CHECK_LOOKBACK_DAYS)}T00:00:00Z`,
              ),
            },
          },
          select: { id: true, date: true, amountCents: true, description: true, accountId: true },
        })
      ).map((t) => ({ ...t, date: isoDate(t.date), pfc: null }))
    : [];
  const today = isoDate(now);
  const checkOf = (r: (typeof rows)[number]) => {
    const w = asWatch(r.watch);
    if (r.status !== "open" || !w || isHoldingsWatch(w) || !(r.doneAt ?? r.answeredAt)) return null;
    return checksOn(w, startOf(r), charges);
  };
  const view = (r: (typeof rows)[number]): OutcomeView => ({
    key: r.suggestionKey,
    topic: r.topic,
    title: r.title,
    status: r.status,
    expectedCents: r.expectedCents,
    confirmedCents: r.confirmedCents,
    yearly: r.yearly,
    verifiedPercent: r.verifiedPercent,
    proof: r.proof,
    evidence: lines(r.evidenceTxIds),
    actedOn: (r.doneAt ?? r.answeredAt) ? isoDate((r.doneAt ?? r.answeredAt)!) : null,
    markedDone: r.doneAt !== null,
    verifiedOn: r.verifiedAt ? isoDate(r.verifiedAt) : null,
    state: ledgerStateOf(r) ?? "done",
    foundOn: isoDate(r.firstShownAt),
    confidencePercent: r.confidencePercent,
    rule: verifyRule(asWatch(r.watch)),
    heldOn: r.heldAt ? isoDate(r.heldAt) : null,
    lapsed: r.status === "lapsed",
    heldProof: r.heldProof,
    heldEvidence: lines(r.heldEvidenceTxIds),
    checksOn: checkOf(r)?.on ?? null,
    checkWords: checkWords(checkOf(r), today),
  });
  const confirmed = rows
    .filter((r) => r.status === "confirmed" || r.status === "partial")
    .map(view);
  const expected = rows.filter((r) => r.status === "open" || r.status === "unverifiable").map(view);
  const notSeen = rows.filter((r) => r.status === "not_seen" || r.status === "lapsed").map(view);
  return {
    confirmed,
    expected,
    notSeen,
    confirmedCents: confirmed.reduce((s, r) => s + (r.confirmedCents ?? 0), 0),
    expectedCents: expected.reduce((s, r) => s + r.expectedCents, 0),
  };
}
