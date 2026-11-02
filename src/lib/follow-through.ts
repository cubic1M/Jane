import { parsePracticeIdeaId } from "@/config/practice-suggestions";
import { ADVICE_TOPICS } from "@/config/suggestions";
import {
  COMEBACK_LAST_SEEN_DAYS,
  FAILED_CONFIDENCE_REASON,
  NUDGE_CONFIDENCE,
} from "@/config/follow-through";
import type { AlertCandidate } from "@/detection/alerts";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { landing } from "@/lib/area-pages/landing";
import { raiseAlerts } from "@/lib/alerts";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DAY_MS } from "@/lib/dates";
import { localDate } from "@/lib/digest/week";
import { loadFreshness } from "@/lib/freshness";
import { FINDING_OUTCOME_PREFIX } from "@/lib/outcomes";
import { isTrialUser } from "@/lib/trial-ids";
import {
  comebackDue,
  comebackWords,
  comesBack,
  FAILED_STATUSES,
  nudgeDue,
  nudgeWords,
  OPEN_STATUSES,
} from "@/planning/follow-through";
import { statementAsk } from "@/planning/freshness";
import { asWatch } from "@/planning/outcomes";

// Staying on what the person said yes to (the controller's duty 6), for real accounts, read-only.
// The nightly run moves each Yes along (src/planning/follow-through.ts) and raises it through the
// alerts, so it reaches /jane and the weekly email; the dock reads loadFollowUps. A trial person
// has none of it: sample data, gone within hours, never emailed.

type Options = { client?: PrismaClient; now?: Date };

const rowSelect = {
  id: true,
  suggestionKey: true,
  topic: true,
  title: true,
  answer: true,
  status: true,
  answeredAt: true,
  doneAt: true,
  nudgeCount: true,
  lastNudgedAt: true,
  failedAt: true,
  comebacks: true,
  comebackAt: true,
  proof: true,
  heldProof: true,
  watch: true,
  confidencePercent: true,
} as const;

// Stops advice offered in demo advice mode reaching someone who has since added a real account. A
// practice idea's Yes is done the moment it's said: nothing to follow up.
async function followedUp(userId: string, client: PrismaClient) {
  const advice = await adviceMode(userId, { client });
  return (row: { topic: string; suggestionKey: string }) =>
    !parsePracticeIdeaId(row.suggestionKey) &&
    (advice || !(ADVICE_TOPICS as readonly string[]).includes(row.topic));
}

export const personTimezone = async (userId: string, client: PrismaClient) =>
  (await client.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone ??
  null;

// What a failed fix says, on the person's own day (src/lib/digest/week.ts).
export const failedWords = (
  row: {
    answeredAt: Date | null;
    doneAt: Date | null;
    status: string;
    proof: string | null;
    heldProof: string | null;
    watch: unknown;
  },
  timezone: string | null,
) => {
  const acted = row.doneAt ?? row.answeredAt;
  return comebackWords({
    ...row,
    actedOn: acted ? localDate(acted, timezone) : null,
    watch: asWatch(row.watch),
  });
};

export type FollowThroughRun = { nudged: number; cameBack: number; asked: boolean };

export async function runFollowThrough(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    raise = raiseAlerts,
  }: Options & { raise?: typeof raiseAlerts } = {},
): Promise<FollowThroughRun> {
  const run: FollowThroughRun = { nudged: 0, cameBack: 0, asked: false };
  if (isTrialUser(userId)) return run;
  const db = scopedFor(userId, client);
  const allowed = await followedUp(userId, client);
  const rows = (
    await db.suggestionOutcomes.findMany({
      where: { answer: "yes", status: { in: [...OPEN_STATUSES, ...FAILED_STATUSES] } },
      select: rowSelect,
    })
  ).filter(allowed);
  const alerts: AlertCandidate[] = [];
  const timezone = await personTimezone(userId, client);
  for (const row of rows) {
    if (nudgeDue(row, now)) {
      const nudge = row.nudgeCount + 1;
      await db.suggestionOutcomes.updateMany({
        where: { id: row.id },
        data: { nudgeCount: nudge, lastNudgedAt: now },
      });
      alerts.push({
        type: "follow_up",
        key: `nudge:${row.suggestionKey}:${nudge}`,
        title: `Still to do: ${row.title}`,
        body: nudgeWords(row.title, localDate(row.answeredAt!, timezone)),
        confidence: NUDGE_CONFIDENCE,
      });
      run.nudged += 1;
    } else if (comebackDue(row)) {
      const comeback = row.comebacks + 1;
      await db.suggestionOutcomes.updateMany({
        where: { id: row.id },
        data: { comebacks: comeback, comebackAt: now },
      });
      alerts.push({
        type: "follow_up",
        key: `failed:${row.suggestionKey}:${comeback}`,
        title: `Didn't hold: ${row.title}`,
        body: failedWords(row, timezone),
        confidence: {
          percent: row.confidencePercent || NUDGE_CONFIDENCE.percent,
          reason: FAILED_CONFIDENCE_REASON,
        },
      });
      run.cameBack += 1;
    }
  }
  const ask = statementAsk(await loadFreshness(userId, { client, now }), dayOf(now));
  if (ask) {
    alerts.push({
      type: "statement_due",
      key: ask.key,
      title: ask.title,
      body: ask.body,
      confidence: { percent: 100, reason: "your newest statement's last day" },
    });
    run.asked = true;
  }
  if (alerts.length > 0) await raise(userId, alerts, { client, now });
  await clearSettledAlerts(userId, { client, now });
  return run;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

// A follow-up's key inside its alert's key: "nudge:<key>:<n>" or "failed:<key>:<n>".
export const followUpKeyOf = (alertKey: string): string | null =>
  /^(?:nudge|failed):(.+):\d+$/.exec(alertKey)?.[1] ?? null;

// Which of these keys still need the person: a Yes with nothing done, or a failure not acted on.
export async function stillFollowingUp(
  userId: string,
  keys: readonly string[],
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await scopedFor(userId, client).suggestionOutcomes.findMany({
    where: {
      suggestionKey: { in: [...new Set(keys)] },
      answer: "yes",
      OR: [
        { status: { in: OPEN_STATUSES as string[] }, doneAt: null },
        { status: { in: FAILED_STATUSES as string[] } },
      ],
    },
    select: { suggestionKey: true },
  });
  return new Set(rows.map((r) => r.suggestionKey));
}

// What was settled no longer reads as new on /jane: the person acted, said no, or the data did.
async function clearSettledAlerts(userId: string, { client, now }: Required<Options>) {
  const db = scopedFor(userId, client);
  const unread = await db.alerts.findMany({
    where: { type: { in: ["follow_up", "statement_due"] }, readAt: null },
    select: { id: true, type: true, key: true },
  });
  if (unread.length === 0) return;
  const { alertsThatHold } = await import("@/lib/jane-agent/still-true");
  const held = new Set((await alertsThatHold(userId, unread, { client, now })).map((a) => a.id));
  const over = unread.filter((a) => !held.has(a.id)).map((a) => a.id);
  if (over.length > 0) {
    await db.alerts.updateMany({ where: { id: { in: over } }, data: { readAt: now } });
  }
}

export type FollowUp = {
  key: string;
  // A nudge, or a fix that didn't hold and can't come back as a suggestion.
  kind: "nudge" | "failed";
  // Which nudge or comeback this is: a later one replaces the card.
  round: number;
  body: string;
  href: string;
};

const SEEN_DAYS_MS = COMEBACK_LAST_SEEN_DAYS * DAY_MS;

// The dock's follow-up cards. A nudge shows from the night it was raised until the person answers.
// A failure the scan can bring back as a suggestion (still firing, not a finding card) is left to
// that card (src/lib/suggestions.ts).
export async function loadFollowUps(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FollowUp[]> {
  if (isTrialUser(userId)) return [];
  const db = scopedFor(userId, client);
  const rows = await db.suggestionOutcomes.findMany({
    where: {
      answer: "yes",
      OR: [
        { status: { in: OPEN_STATUSES as string[] }, doneAt: null, nudgeCount: { gt: 0 } },
        { status: { in: FAILED_STATUSES as string[] }, comebacks: { gt: 0 } },
      ],
    },
    select: rowSelect,
    orderBy: [{ answeredAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const allowed = await followedUp(userId, client);
  const timezone = await personTimezone(userId, client);
  const suggestions = new Map(
    (
      await db.suggestions.findMany({
        where: { key: { in: rows.map((r) => r.suggestionKey) } },
        select: { key: true, topic: true, actionHref: true, lastSeenAt: true },
      })
    ).map((s) => [s.key, s]),
  );
  const hrefOf = (key: string, topic: string) => {
    if (key.startsWith(FINDING_OUTCOME_PREFIX)) {
      return `/report/${key.slice(FINDING_OUTCOME_PREFIX.length)}#diy`;
    }
    const s = suggestions.get(key);
    return s ? landing(s.actionHref, { key, topic }) : "/saved#open";
  };
  return rows.flatMap((r): FollowUp[] => {
    if (!allowed(r)) return [];
    if (OPEN_STATUSES.includes(r.status)) {
      return [
        {
          key: r.suggestionKey,
          kind: "nudge",
          round: r.nudgeCount,
          body: nudgeWords(r.title, localDate(r.answeredAt!, timezone)),
          href: hrefOf(r.suggestionKey, r.topic),
        },
      ];
    }
    if (!comesBack(r)) return [];
    const s = suggestions.get(r.suggestionKey);
    if (s && now.getTime() - s.lastSeenAt.getTime() < SEEN_DAYS_MS) return [];
    return [
      {
        key: r.suggestionKey,
        kind: "failed",
        round: r.comebacks,
        body: `${r.title.trim().replace(/[.!]+$/, "")}: ${failedWords(r, timezone)}`,
        href: hrefOf(r.suggestionKey, r.topic),
      },
    ];
  });
}
