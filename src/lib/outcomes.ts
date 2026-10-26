import { WATCH_DAYS } from "@/config/outcomes";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import type { Watch } from "@/detectors/contract";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { asWatch, verifyWatch, watchOfFinding, type OutcomeTx } from "@/planning/outcomes";
import { DAY_MS, isoDay as isoDate } from "@/lib/dates";

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
// Statuses after a yes or a done.
const ACTED = ["open", "partial", "not_seen", "confirmed", "unverifiable"];

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
  await scopedFor(userId, client).suggestionOutcomes.updateMany({
    where: { id: outcome.id },
    data: {
      answer,
      answeredAt: now,
      status: answer === "no" ? "declined" : asWatch(outcome.watch) ? "open" : "unverifiable",
    },
  });
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
  await db.suggestionOutcomes.create({
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
}

// Each night: the open outcomes against the transactions. Returns what changed.
export async function verifyOutcomes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input: given,
  }: Options & { input?: DetectionInput } = {},
): Promise<{ checked: number; confirmed: number; notSeen: number }> {
  const db = scopedFor(userId, client);
  const open = await db.suggestionOutcomes.findMany({ where: { status: { in: CHECKED } } });
  if (open.length === 0) return { checked: 0, confirmed: 0, notSeen: 0 };
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const txs: OutcomeTx[] = input.transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    description: t.description,
    pfc: t.pfcDetailed,
  }));
  const asOf = isoDate(now);
  let confirmed = 0;
  let notSeen = 0;
  for (const o of open) {
    const watch = asWatch(o.watch);
    const started = o.doneAt ?? o.answeredAt;
    if (!watch || !started) {
      await db.suggestionOutcomes.updateMany({
        where: { id: o.id },
        data: { status: "unverifiable", checkedAt: now },
      });
      continue;
    }
    // Long past its window (twice over): it stays as it is.
    if (now.getTime() - started.getTime() > 2 * WATCH_DAYS[watch.kind] * DAY_MS) continue;
    const check = verifyWatch(
      watch,
      { startedOn: isoDate(started), asOf, expectedCents: o.expectedCents },
      txs,
    );
    if (check.status === "waiting") {
      await db.suggestionOutcomes.updateMany({ where: { id: o.id }, data: { checkedAt: now } });
      continue;
    }
    if (check.status === "not_seen") {
      if (o.status !== "not_seen") notSeen += 1;
      await db.suggestionOutcomes.updateMany({
        where: { id: o.id },
        data: {
          status: "not_seen",
          evidenceTxIds: check.evidence,
          proof: check.proof,
          checkedAt: now,
        },
      });
      continue;
    }
    if (check.status === "confirmed" && o.status !== "confirmed") confirmed += 1;
    await db.suggestionOutcomes.updateMany({
      where: { id: o.id },
      data: {
        status: check.status,
        confirmedCents: check.cents,
        yearly: check.yearly,
        verifiedPercent: check.percent,
        evidenceTxIds: check.evidence,
        proof: check.proof,
        checkedAt: now,
        verifiedAt: o.verifiedAt ?? now,
      },
    });
  }
  return { checked: open.length, confirmed, notSeen };
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
};

// Why an expected saving isn't counted yet, in the person's words: "You said yes" until they mark
// it done (QA round 11: it said "You did it" after a bare yes).
export function expectedWhy(o: Pick<OutcomeView, "status" | "actedOn" | "markedDone">): string {
  const did = o.markedDone ? "You did it" : "You said yes";
  if (o.status === "unverifiable") return `${did}; it isn't something your transactions can show.`;
  return `${did}${o.actedOn ? ` on ${o.actedOn}` : ""}. It counts once your transactions show it.`;
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
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<SavingsRecord> {
  const db = scopedFor(userId, client);
  const rows = await db.suggestionOutcomes.findMany({
    where: { status: { in: ACTED } },
    orderBy: [{ verifiedAt: "asc" }, { answeredAt: "asc" }, { id: "asc" }],
  });
  const ids = [...new Set(rows.flatMap((r) => r.evidenceTxIds))];
  const txs =
    ids.length > 0
      ? await db.transactions.findMany({
          where: { id: { in: ids } },
          select: { id: true, date: true, description: true, amountCents: true },
        })
      : [];
  const byId = new Map(txs.map((t) => [t.id, t]));
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
    evidence: r.evidenceTxIds.flatMap((id) => {
      const t = byId.get(id);
      return t
        ? [
            {
              id,
              date: isoDate(t.date),
              description: t.description,
              amountCents: t.amountCents,
            },
          ]
        : [];
    }),
    actedOn: (r.doneAt ?? r.answeredAt) ? isoDate((r.doneAt ?? r.answeredAt)!) : null,
    markedDone: r.doneAt !== null,
    verifiedOn: r.verifiedAt ? isoDate(r.verifiedAt) : null,
  });
  const confirmed = rows
    .filter((r) => r.status === "confirmed" || r.status === "partial")
    .map(view);
  const expected = rows.filter((r) => r.status === "open" || r.status === "unverifiable").map(view);
  const notSeen = rows.filter((r) => r.status === "not_seen").map(view);
  return {
    confirmed,
    expected,
    notSeen,
    confirmedCents: confirmed.reduce((s, r) => s + (r.confirmedCents ?? 0), 0),
    expectedCents: expected.reduce((s, r) => s + r.expectedCents, 0),
  };
}
