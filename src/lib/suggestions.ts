import { landing } from "@/lib/area-pages/landing";
import { STRATEGIST_CAPABILITY, STRATEGIST_IDEA_DAYS, STRATEGIST_TOPIC } from "@/config/strategist";
import { promisesHiddenPage } from "@/config/hidden-pages";
import { ADVICE_TOPICS, RESELECT_AFTER_DAYS, rankValue } from "@/config/suggestions";
import { runDetectors } from "@/detectors";
import type { Suggestion } from "@/detectors/contract";
import { ideaShortForms } from "@/detectors/helpers";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadProfileInput } from "@/lib/profile";
import { recordAnswer, recordOpened, recordShown } from "@/lib/outcomes";
import { loadKindStats } from "@/lib/learning";
import type { CardExtras } from "@/lib/jane-agent/types";
import { scrub } from "@/lib/scrub";
import { resultsByKind } from "@/lib/worked";
import { buildProfile, type Profile, type ProfileInput } from "@/profile/build";
import { learnFromAnswer, learnFromData } from "@/lib/memory/learn";
import {
  byRank,
  mergeOverlaps,
  peopleLine,
  pickForToday,
  rankSuggestions,
  type TopicHistory,
} from "@/planning/suggestion-rank";
import { DAY_MS, isoDay as dayOf } from "@/lib/dates";
import { withReadCache } from "@/lib/read-cache";
import { suggestionCard } from "@/lib/jane-agent/sources/suggestions";

// The nightly scan (spec step 255): every detector for one person, ranked by dollars x
// confidence x urgency and adjusted by what they have said yes and no to (step 207). Only the
// top few reach them a day (step 147's budget); the rest wait and are ranked again tomorrow.
// Nothing is shown again after a no. Detectors are pure (src/detectors); this is the one place
// that reads the person, runs them and keeps the result.

type Options = { client?: PrismaClient; now?: Date };

export type OfferedSuggestion = {
  id: string;
  key: string;
  topic: string;
  title: string;
  // The short forms (docs/detectors.md); the title and why for rows from before they existed.
  headline: string;
  short: string;
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
  // A practice idea's numbers, caps and what its Yes does, for the card's More details.
  cardDetails?: CardExtras;
  // The learning loop, for More details: "People acted on this 7 of 10 times it was shown."
  people?: string;
};

export type ScanResult = { fired: number; selected: string[] };

// Every detector for one person, tonight: what applies to them and what Jane may show them
// (no recommendations on investments, taxes, insurance or loans outside demo advice mode).
// Every detector, over the same facts read once (src/lib/read-cache.ts).
export async function detectFor(
  userId: string,
  options: Options = {},
): Promise<{
  suggestions: Suggestion[];
  advice: boolean;
  today: string;
  profile: Profile;
  input: ProfileInput;
}> {
  return withReadCache(options.client ?? defaultClient, (client) =>
    detectForWork(userId, { ...options, client }),
  );
}

async function detectForWork(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{
  suggestions: Suggestion[];
  advice: boolean;
  today: string;
  profile: Profile;
  input: ProfileInput;
}> {
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
  return { suggestions: forTheBeta(suggestions), advice, today: input.today, profile, input };
}

// What the closed beta may show: none whose button promises a task on a page it hides
// (src/config/hidden-pages.ts), for as long as the page is hidden. Not fired, so the scan marks
// one already stored "gone", and the dock, the chat's cards, Home and the area pages leave it
// out; it comes back when its page does.
export function forTheBeta<T extends Pick<Suggestion, "action" | "more">>(suggestions: T[]): T[] {
  return suggestions.filter(
    (s) => !promisesHiddenPage(s.action) && !(s.more ?? []).some(promisesHiddenPage),
  );
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
        ...ideaShortForms(e.title, e.why),
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
        rankCents: have.reduce((s, p) => s + rankValue(p.topic, p.worthKind, p.worthCents), 0),
      },
    ];
  });
}

// The nightly scan runs every detector over the same facts: one read each (src/lib/read-cache.ts).
export async function scanSuggestions(userId: string, options: Options = {}): Promise<ScanResult> {
  return withReadCache(options.client ?? defaultClient, (client) =>
    scanSuggestionsWork(userId, { ...options, client }),
  );
}

// Today's picks split into those that still fire and those that stopped (ideas are checked
// by the full scan, so they stay).
export function stillChosen<T extends { key: string }>(
  chosen: readonly T[],
  firing: ReadonlySet<string>,
): { keep: T[]; outdated: T[] } {
  const outdated = chosen.filter((c) => !isIdea(c.key) && !firing.has(c.key));
  return { keep: chosen.filter((c) => !outdated.includes(c)), outdated };
}

// Today's picks that still fire take the new figures, and so does the chat message each was
// offered in (overnight upload QA: idle cash said "$548/yr" from the checking file alone and
// kept saying it after the card's spending made it $473). Their place and status don't change.
async function refreshFigures(
  userId: string,
  keep: readonly { id: string; key: string }[],
  found: readonly Suggestion[],
  { client, now }: { client: PrismaClient; now: Date },
): Promise<void> {
  const db = scopedFor(userId, client);
  const byId = new Map(found.map((f) => [f.id, f]));
  for (const pick of keep) {
    const s = byId.get(pick.key);
    if (!s || isIdea(pick.key)) continue;
    await db.suggestions.updateMany({
      where: { id: pick.id },
      data: {
        title: s.title,
        headline: s.headline,
        short: s.short,
        worthCents: s.worthCents,
        worthKind: s.worthKind,
        confidencePercent: s.confidence.percent,
        confidenceReason: s.confidence.reason,
        urgency: s.urgency,
        why: s.why,
        lastSeenAt: now,
      },
    });
    const body = suggestionCard({
      headline: s.headline,
      short: s.short,
      confidencePercent: s.confidence.percent,
      confidenceReason: s.confidence.reason,
    } as OfferedSuggestion).join("\n");
    const open = await db.janeMessages.findMany({
      where: { status: "open", refs: { path: ["suggestion"], equals: pick.key } },
      select: { id: true, body: true, refs: true },
    });
    for (const m of open) {
      if (m.body === body) continue;
      await db.janeMessages.updateMany({
        where: { id: m.id, status: "open" },
        data: {
          body,
          refs: { ...(m.refs as Prisma.JsonObject), suggestionWhy: s.why },
        },
      });
    }
  }
}

async function scanSuggestionsWork(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ScanResult> {
  const db = scopedFor(userId, client);
  const today = dayOf(now);
  const [{ suggestions: found, advice, profile, input }, stored] = await Promise.all([
    detectFor(userId, { client, now }),
    db.suggestions.findMany(),
  ]);
  // What the scan saw is evidence for what Jane knows about the person (src/lib/memory/).
  await learnFromData(userId, profile, input, { client, now });
  // Advice offered while the person was in demo advice mode must not outlive it: once a real
  // account is added, those rows go, answered or not (they would show as recommendations).
  const isAdviceRow = (topic: string) => (ADVICE_TOPICS as readonly string[]).includes(topic);
  if (!advice && stored.some((e) => isAdviceRow(e.topic))) {
    await client.suggestion.deleteMany({
      where: { userId, topic: { in: [...ADVICE_TOPICS] } },
    });
  }
  const existing = advice ? stored : stored.filter((e) => !isAdviceRow(e.topic));
  const byKey = new Map(existing.map((e) => [e.key, e]));

  // Already chosen for today: the scan is safe to run twice. But a pick that no longer fires
  // goes, even the same day: a second upload can show the car is insured after all (import QA:
  // "Check your car is insured" stayed on top after the insurance payments came in).
  const chosen = existing.filter(
    (e) => e.selectedOn && dayOf(e.selectedOn) === today && e.status === "selected",
  );
  if (chosen.length > 0) {
    const { keep, outdated } = stillChosen(chosen, new Set(found.map((f) => f.id)));
    if (outdated.length > 0) {
      await db.suggestions.updateMany({
        where: { id: { in: outdated.map((e) => e.id) } },
        data: { status: "gone" },
      });
    }
    await refreshFigures(userId, keep, found, { client, now });
    return { fired: found.length, selected: keep.map((c) => c.key) };
  }

  const history: Record<string, { yes: number; no: number }> = {};
  for (const e of existing) {
    if (e.status !== "yes" && e.status !== "no") continue;
    const h = (history[e.topic] ??= { yes: 0, no: 0 });
    if (e.status === "yes") h.yes += 1;
    else h.no += 1;
  }
  const [results, kinds] = await Promise.all([
    resultsByKind(userId, { client, now }),
    // The learning loop: what everyone did with each kind.
    loadKindStats({ client }),
  ]);

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
      kinds,
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
      headline: s.headline,
      short: s.short,
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      confidencePercent: s.confidence.percent,
      confidenceReason: s.confidence.reason,
      urgency: s.urgency,
      why: s.why,
      actionLabel: s.action.label,
      // A bare area link opens the suggestion's own node on that area's tree.
      actionHref: landing(s.action.href, { key: s.id, topic: s.topic }),
      score: scores.get(s.id) ?? 0,
      lastSeenAt: now,
      // What later transactions should show if the person acts (the verified savings record).
      watch: s.watch ? (s.watch as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
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
  // The day's picks reach the person: the verified savings record starts here.
  await recordShown(
    userId,
    picked.map(({ suggestion: p }) => ({
      key: p.id,
      capability: p.capability,
      topic: p.topic,
      title: p.title,
      worthCents: p.worthCents,
      worthKind: p.worthKind,
      confidencePercent: p.confidence.percent,
      watch: p.watch ?? null,
    })),
    { client, now },
  );
  return { fired: found.length, selected: [...pickedIds] };
}

// The ones chosen for today and not answered, for the chat to offer.
export async function offeredToday(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<OfferedSuggestion[]> {
  const rows = (
    await scopedFor(userId, client).suggestions.findMany({
      where: { status: "selected", selectedOn: new Date(dayOf(now)) },
    })
  ).sort((a, b) => byRank({ ...a, id: a.key }, { ...b, id: b.key }));
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
  // Loaded when needed: the practice modules reach this file again (through the profile).
  const { practiceCardDetails } = await import("@/lib/practice/ideas");
  const [practice, kinds] = await Promise.all([
    practiceCardDetails(
      userId,
      rows.map((r) => r.key),
      { client },
    ),
    loadKindStats({ client }),
  ]);
  return rows.map((r) => {
    const mine = isIdea(r.key) ? partsOfIdea(r.key).flatMap((k) => partOf.get(k) ?? []) : [];
    const topics = mine.length > 0 ? mine.map((p) => p.topic) : [r.topic];
    return {
      id: r.id,
      key: r.key,
      topic: r.topic,
      title: r.title,
      headline: r.headline || r.title,
      short: r.short || r.why,
      why: r.why,
      worthCents: r.worthCents,
      worthKind: r.worthKind,
      confidencePercent: r.confidencePercent,
      confidenceReason: r.confidenceReason,
      actionLabel: mine[0]?.actionLabel ?? r.actionLabel,
      // Landed again as shown, so one stored before a page was hidden (src/config/hidden-pages.ts)
      // opens its area page instead.
      actionHref: landing(mine[0]?.actionHref ?? r.actionHref, { key: r.key, topic: r.topic }),
      more: mine.slice(1).map((p) => ({ label: p.actionLabel, href: landing(p.actionHref) })),
      advice: topics.some((t) => (ADVICE_TOPICS as readonly string[]).includes(t)),
      ...(practice.has(r.key) ? { cardDetails: practice.get(r.key) } : {}),
      ...(peopleLine(r.topic, kinds) ? { people: peopleLine(r.topic, kinds)! } : {}),
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
  await recordAnswer(userId, key, answer, { client, now });
  await learnFromAnswer(
    userId,
    { topic: row.topic, acted: answer === "yes", ref: `suggestion:${key}` },
    { client, now },
  );
  await track(userId, "suggestion_answered", {
    topic: row.topic,
    answer,
    percent: row.confidencePercent,
  });
  return { title: row.title, actionHref: row.actionHref };
}

// The full explanation behind a suggestion's "Why?": its whole title and why, in the person's
// figures, and how sure Jane is with the reason.
export async function explainSuggestion(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const row = await scopedFor(userId, client).suggestions.findFirst({ where: { key } });
  if (!row) throw new SuggestionError("That suggestion isn't there any more.");
  await recordOpened(userId, key, { client, now });
  const end = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  return [
    end(row.title),
    end(row.why),
    `I'm ${row.confidencePercent}% sure, based on ${row.confidenceReason}.`,
  ].join(" ");
}
