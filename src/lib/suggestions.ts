import { STRATEGIST_CAPABILITY, STRATEGIST_IDEA_DAYS, STRATEGIST_TOPIC } from "@/config/strategist";
import { ADVICE_TOPICS, RESELECT_AFTER_DAYS, WORTH_WEIGHT } from "@/config/suggestions";
import { runDetectors } from "@/detectors";
import type { Suggestion } from "@/detectors/contract";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadProfileInput } from "@/lib/profile";
import { scrub } from "@/lib/scrub";
import { resultsByKind } from "@/lib/worked";
import { buildProfile } from "@/profile/build";
import {
  mergeOverlaps,
  pickForToday,
  rankSuggestions,
  type TopicHistory,
} from "@/planning/suggestion-rank";

// The nightly scan (spec step 255): every detector for one person, ranked by dollars x
// confidence x urgency and adjusted by what they have said yes and no to (step 207). Only the
// top few reach them a day (step 147's budget); the rest wait and are ranked again tomorrow.
// Nothing is shown again after a no. Detectors are pure (src/detectors); this is the one place
// that reads the person, runs them and keeps the result.

type Options = { client?: PrismaClient; now?: Date };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export type OfferedSuggestion = {
  id: string;
  key: string;
  topic: string;
  title: string;
  why: string;
  worthCents: number;
  worthKind: string;
  confidencePercent: number;
  confidenceReason: string;
  actionLabel: string;
  actionHref: string;
  // A strategist idea (step 256) ends in the buttons of every suggestion it combines.
  more: { label: string; href: string }[];
  // Whether it is a recommendation on investments, taxes, insurance or loans (demo advice).
  advice: boolean;
};

export type ScanResult = { fired: number; selected: string[] };

// Every detector for one person, tonight: what applies to them and what Jane may show them
// (no recommendations on investments, taxes, insurance or loans outside demo advice mode).
export async function detectFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ suggestions: Suggestion[]; advice: boolean }> {
  const [input, advice] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  const profile = buildProfile(input);
  const suggestions = runDetectors({ profile, data: input }, undefined, (d, error) =>
    console.error("Detector failed", {
      userId,
      detector: `${d.capability}:${d.topic}`,
      error: scrub(String(error)),
    }),
  ).filter((s) => advice || !(ADVICE_TOPICS as readonly string[]).includes(s.topic));
  return { suggestions, advice };
}

const isIdea = (key: string) => key.startsWith(`${STRATEGIST_CAPABILITY}:`);
const partsOfIdea = (key: string) => key.slice(STRATEGIST_CAPABILITY.length + 1).split("+");

// Strategist ideas (step 256) still open and still resting on suggestions that fire tonight,
// as suggestions again: their confidence is the weakest of those parts', as tonight stands.
function openIdeas(
  existing: readonly {
    key: string;
    title: string;
    why: string;
    worthCents: number;
    worthKind: string;
    urgency: string;
    status: string;
    lastSeenAt: Date;
  }[],
  fired: ReadonlyMap<string, Suggestion>,
  now: Date,
): Suggestion[] {
  return existing.flatMap((e) => {
    if (!isIdea(e.key) || (e.status !== "waiting" && e.status !== "selected")) return [];
    if (now.getTime() - e.lastSeenAt.getTime() > STRATEGIST_IDEA_DAYS * DAY_MS) return [];
    const parts = partsOfIdea(e.key).map((id) => fired.get(id));
    if (parts.some((p) => !p)) return [];
    const have = parts as Suggestion[];
    const weakest = have.reduce((a, b) => (b.confidence.percent < a.confidence.percent ? b : a));
    return [
      {
        id: e.key,
        capability: STRATEGIST_CAPABILITY,
        topic: STRATEGIST_TOPIC,
        title: e.title,
        worthCents: e.worthCents,
        worthKind: e.worthKind as Suggestion["worthKind"],
        confidence: {
          percent: weakest.confidence.percent,
          reason: `the weakest part of this idea: ${weakest.confidence.reason}`,
        },
        urgency: e.urgency as Suggestion["urgency"],
        why: e.why,
        action: have[0].action,
        more: have.slice(1).map((p) => p.action),
        parts: have.map((p) => p.id),
        rankCents: have.reduce((s, p) => s + p.worthCents * WORTH_WEIGHT[p.worthKind], 0),
      },
    ];
  });
}

export async function scanSuggestions(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ScanResult> {
  const db = scopedFor(userId, client);
  const today = dayOf(now);
  const [{ suggestions: found }, existing] = await Promise.all([
    detectFor(userId, { client, now }),
    db.suggestions.findMany(),
  ]);
  const byKey = new Map(existing.map((e) => [e.key, e]));

  // Already chosen for today: the scan is safe to run twice.
  const chosen = existing.filter(
    (e) => e.selectedOn && dayOf(e.selectedOn) === today && e.status === "selected",
  );
  if (chosen.length > 0) return { fired: found.length, selected: chosen.map((c) => c.key) };

  const history: Record<string, { yes: number; no: number }> = {};
  for (const e of existing) {
    if (e.status !== "yes" && e.status !== "no") continue;
    const h = (history[e.topic] ??= { yes: 0, no: 0 });
    if (e.status === "yes") h.yes += 1;
    else h.no += 1;
  }
  const results = await resultsByKind(userId, { client, now });

  // Never again after an answer; not again for a while after it was offered and left alone.
  const blocked = new Set<string>();
  for (const e of existing) {
    if (e.status === "yes" || e.status === "no") blocked.add(e.key);
    else if (
      e.selectedOn &&
      now.getTime() - e.selectedOn.getTime() < RESELECT_AFTER_DAYS * DAY_MS
    ) {
      blocked.add(e.key);
    }
  }
  const ideas = openIdeas(existing, new Map(found.map((s) => [s.id, s])), now);
  const ranked = mergeOverlaps(
    rankSuggestions([...found, ...ideas], {
      history: history as TopicHistory,
      results,
      blocked,
    }),
  );
  const picked = pickForToday(ranked);
  const pickedIds = new Set(picked.map((r) => r.suggestion.id));
  const scores = new Map(ranked.map((r) => [r.suggestion.id, r.score]));

  for (const s of found) {
    const data = {
      capability: s.capability,
      topic: s.topic,
      title: s.title,
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      confidencePercent: s.confidence.percent,
      confidenceReason: s.confidence.reason,
      urgency: s.urgency,
      why: s.why,
      actionLabel: s.action.label,
      actionHref: s.action.href,
      score: scores.get(s.id) ?? 0,
      lastSeenAt: now,
    };
    const have = byKey.get(s.id);
    const answered = have?.status === "yes" || have?.status === "no";
    const selected = pickedIds.has(s.id);
    await client.suggestion.upsert({
      where: { userId_key: { userId, key: s.id } },
      create: {
        userId,
        key: s.id,
        ...data,
        status: selected ? "selected" : "waiting",
        selectedOn: selected ? new Date(today) : null,
      },
      update: {
        ...data,
        ...(answered
          ? { status: have!.status }
          : selected
            ? { status: "selected", selectedOn: new Date(today) }
            : { status: "waiting" }),
      },
    });
  }
  // Ideas keep their own text; only whether they were picked, and their score, change.
  for (const idea of ideas) {
    const selected = pickedIds.has(idea.id);
    await db.suggestions.updateMany({
      where: { key: idea.id },
      data: {
        score: scores.get(idea.id) ?? 0,
        confidencePercent: idea.confidence.percent,
        confidenceReason: idea.confidence.reason,
        ...(selected ? { status: "selected", selectedOn: new Date(today) } : { status: "waiting" }),
      },
    });
  }
  // What stopped applying is gone (unless the person already answered it); an idea goes
  // when a suggestion it rests on does, or when it gets old.
  const firedKeys = new Set(found.map((s) => s.id));
  const liveIdeas = new Set(ideas.map((i) => i.id));
  const stale = existing.filter(
    (e) =>
      (e.status === "waiting" || e.status === "selected") &&
      (isIdea(e.key) ? !liveIdeas.has(e.key) : !firedKeys.has(e.key)),
  );
  if (stale.length > 0) {
    await db.suggestions.updateMany({
      where: { id: { in: stale.map((e) => e.id) } },
      data: { status: "gone" },
    });
  }
  return { fired: found.length, selected: [...pickedIds] };
}

// The ones chosen for today and not answered, for the chat to offer.
export async function offeredToday(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<OfferedSuggestion[]> {
  const rows = await scopedFor(userId, client).suggestions.findMany({
    where: { status: "selected", selectedOn: new Date(dayOf(now)) },
    orderBy: [{ score: "desc" }, { key: "asc" }],
  });
  // An idea's buttons are those of the suggestions it combines.
  const partKeys = rows.filter((r) => isIdea(r.key)).flatMap((r) => partsOfIdea(r.key));
  const parts =
    partKeys.length > 0
      ? await scopedFor(userId, client).suggestions.findMany({
          where: { key: { in: partKeys } },
          select: { key: true, topic: true, actionLabel: true, actionHref: true },
        })
      : [];
  const partOf = new Map(parts.map((p) => [p.key, p]));
  return rows.map((r) => {
    const mine = isIdea(r.key) ? partsOfIdea(r.key).flatMap((k) => partOf.get(k) ?? []) : [];
    const topics = mine.length > 0 ? mine.map((p) => p.topic) : [r.topic];
    return {
      id: r.id,
      key: r.key,
      topic: r.topic,
      title: r.title,
      why: r.why,
      worthCents: r.worthCents,
      worthKind: r.worthKind,
      confidencePercent: r.confidencePercent,
      confidenceReason: r.confidenceReason,
      actionLabel: mine[0]?.actionLabel ?? r.actionLabel,
      actionHref: mine[0]?.actionHref ?? r.actionHref,
      more: mine.slice(1).map((p) => ({ label: p.actionLabel, href: p.actionHref })),
      advice: topics.some((t) => (ADVICE_TOPICS as readonly string[]).includes(t)),
    };
  });
}

export class SuggestionError extends Error {}

// The person's answer. A no is for good: the scan never offers it again.
export async function answerSuggestion(
  userId: string,
  key: string,
  answer: "yes" | "no",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ title: string; actionHref: string }> {
  const db = scopedFor(userId, client);
  const row = await db.suggestions.findFirst({ where: { key } });
  if (!row) throw new SuggestionError("That suggestion isn't there any more.");
  await db.suggestions.updateMany({
    where: { id: row.id },
    data: { status: answer, answeredAt: now },
  });
  await track(userId, "suggestion_answered", {
    topic: row.topic,
    answer,
    percent: row.confidencePercent,
  });
  return { title: row.title, actionHref: row.actionHref };
}
