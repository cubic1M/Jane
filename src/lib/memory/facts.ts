import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ANSWER_FLOOR,
  CHAT_MEMORY_FACTS,
  CONFIRM_STEP,
  CONTRADICT_STEP,
  FACT_LABEL_MAX,
  FACT_SOURCES,
  FACT_TEXT_MAX,
  MAX_CONFIDENCE,
  SOURCE_RANK,
  START_CONFIDENCE,
  SUPERSEDE_BELOW,
  USE_FROM_CONFIDENCE,
  type FactSource,
} from "@/config/memory";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { Told } from "@/profile/build";
import { FACT_KEYS, type FactKey, factSpec } from "@/profile/facts";
import { isSensitiveFact } from "./sensitive";

// What Jane knows about the person (user_facts), refined by every interaction: uploads and the
// nightly scan (./from-data.ts), answers and corrections (src/lib/jane-agent/preferences.ts),
// the chat (./from-chat.ts) and what they did with suggestions and cards. Each new piece of
// evidence confirms what's known (more sure), contradicts it (less sure, or replaced when it's
// the person's own word) or adds something new. Sensitive traits are never stored
// (./sensitive.ts). Jane's chat and the detectors read it (memoryForChat, toldFromFacts); the
// person sees, corrects and deletes it on /settings/memory.

export type FactValue = string | number | boolean;

export type FactDraft = {
  key: string;
  value: FactValue;
  label: string;
  source: FactSource;
  // The interaction it came from ("jane_message:<id>"); repeating the same one isn't new evidence.
  sourceRef?: string | null;
  // How sure this evidence makes it, when it says (the profile's confidence); else by source.
  confidence?: number;
};

export type KnownFact = {
  id: string;
  key: string;
  value: FactValue;
  label: string;
  source: FactSource;
  sourceRef: string | null;
  confidence: number;
  evidenceCount: number;
  firstSeen: Date;
  lastConfirmed: Date;
};

export type RecordOutcome =
  "created" | "confirmed" | "unchanged" | "superseded" | "weakened" | "blocked" | "forgotten";

type Options = { client?: PrismaClient; now?: Date };

// A deleted fact leaves this behind (with no value), so the data alone doesn't bring it back.
const FORGOTTEN = "forgotten";
const DAY_MS = 86_400_000;

const clamp = (n: number) => Math.max(0, Math.min(MAX_CONFIDENCE, Math.round(n)));
const isSource = (s: string): s is FactSource => (FACT_SOURCES as readonly string[]).includes(s);
const valueOf = (json: unknown): FactValue | null => {
  const v = (json as { value?: unknown } | null)?.value;
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
};
const same = (a: FactValue, b: FactValue) =>
  typeof a === "string" && typeof b === "string"
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : a === b;

type Current = {
  value: FactValue;
  source: FactSource;
  sourceRef: string | null;
  confidence: number;
};

export type Weighing =
  | { kind: "create"; confidence: number }
  | { kind: "confirm"; confidence: number; newEvidence: boolean }
  | { kind: "supersede"; confidence: number }
  | { kind: "weaken"; confidence: number };

// What one new piece of evidence does to what's known. Pure.
// - Nothing known: a new fact, as sure as the evidence.
// - The same value: more sure, unless it's the same evidence again (the nightly scan reading
//   the same data), which only keeps the surer of the two.
// - A different value from evidence at least as strong (the person said otherwise, or newer
//   data of the same kind): the new value replaces it, the old one kept as history. What the
//   person did with suggestions (action) only flips after enough of it: it's weakened first.
// - A different value from weaker evidence: less sure; replaced once it falls below
//   SUPERSEDE_BELOW. What the person answered never falls below ANSWER_FLOOR from that.
export function weigh(current: Current | null, draft: FactDraft): Weighing {
  const given = clamp(draft.confidence ?? START_CONFIDENCE[draft.source]);
  if (!current) return { kind: "create", confidence: given };
  if (same(current.value, draft.value)) {
    const repeat =
      draft.source === current.source && (draft.sourceRef ?? null) === current.sourceRef;
    return repeat
      ? { kind: "confirm", confidence: Math.max(current.confidence, given), newEvidence: false }
      : {
          kind: "confirm",
          confidence: clamp(Math.max(current.confidence, given) + CONFIRM_STEP),
          newEvidence: true,
        };
  }
  const rank = SOURCE_RANK[draft.source];
  const held = SOURCE_RANK[current.source];
  if (rank > held || (rank === held && draft.source !== "action")) {
    return { kind: "supersede", confidence: given };
  }
  const lowered = current.confidence - CONTRADICT_STEP;
  if (current.source === "answer") {
    return { kind: "weaken", confidence: Math.max(ANSWER_FLOOR, lowered) };
  }
  return lowered < SUPERSEDE_BELOW
    ? { kind: "supersede", confidence: given }
    : { kind: "weaken", confidence: lowered };
}

const toKnown = (row: {
  id: string;
  key: string;
  value: Prisma.JsonValue;
  label: string;
  source: string;
  sourceRef: string | null;
  confidence: number;
  evidenceCount: number;
  firstSeen: Date;
  lastConfirmed: Date;
}): KnownFact | null => {
  const value = valueOf(row.value);
  if (value === null || !isSource(row.source)) return null;
  return { ...row, value, source: row.source };
};

const tidy = (draft: FactDraft): FactDraft => ({
  ...draft,
  key: draft.key.slice(0, FACT_TEXT_MAX + 20),
  label: draft.label.trim().slice(0, FACT_LABEL_MAX),
  value: typeof draft.value === "string" ? draft.value.trim().slice(0, FACT_TEXT_MAX) : draft.value,
});

// Records each piece of evidence, in order. Never throws for a sensitive fact: it's dropped.
export async function recordFacts(
  userId: string,
  drafts: readonly FactDraft[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RecordOutcome[]> {
  if (drafts.length === 0) return [];
  const db = scopedFor(userId, client);
  const keys = [...new Set(drafts.map((d) => d.key))];
  const rows = await db.userFacts.findMany({
    where: { key: { in: keys }, supersededById: null },
    orderBy: [{ lastConfirmed: "desc" }, { id: "desc" }],
  });
  // The newest row per key is what's known (two writes racing can leave two).
  const held = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!held.has(row.key)) held.set(row.key, row);

  const outcomes: RecordOutcome[] = [];
  for (const raw of drafts) {
    const draft = tidy(raw);
    if (draft.label === "" || (typeof draft.value === "string" && draft.value === "")) {
      outcomes.push("blocked");
      continue;
    }
    if (isSensitiveFact(draft)) {
      outcomes.push("blocked");
      continue;
    }
    let row = held.get(draft.key) ?? null;
    if (row?.source === FORGOTTEN) {
      // Only the person saying it again brings back what they asked Jane to forget.
      if (SOURCE_RANK[draft.source] < SOURCE_RANK.answer) {
        outcomes.push("forgotten");
        continue;
      }
      await db.userFacts.deleteMany({ where: { id: row.id } });
      row = null;
    }
    const current = row ? toKnown(row) : null;
    const step = weigh(current, draft);
    const data = {
      key: draft.key,
      value: { value: draft.value } as Prisma.InputJsonObject,
      label: draft.label,
      source: draft.source,
      sourceRef: draft.sourceRef ?? null,
      confidence: step.confidence,
      firstSeen: now,
      lastConfirmed: now,
    };
    if (step.kind === "create" || !row) {
      held.set(draft.key, await db.userFacts.create({ data: { userId, ...data } }));
      outcomes.push("created");
    } else if (step.kind === "supersede") {
      const next = await db.userFacts.create({ data: { userId, ...data } });
      await db.userFacts.updateMany({ where: { id: row.id }, data: { supersededById: next.id } });
      held.set(draft.key, next);
      outcomes.push("superseded");
    } else if (step.kind === "weaken") {
      await db.userFacts.updateMany({
        where: { id: row.id },
        data: { confidence: step.confidence },
      });
      held.set(draft.key, { ...row, confidence: step.confidence });
      outcomes.push("weakened");
    } else {
      // The same evidence again changes nothing, beyond noting once a day that it still holds.
      const stale = now.getTime() - row.lastConfirmed.getTime() >= DAY_MS;
      if (!step.newEvidence && step.confidence === row.confidence && !stale) {
        outcomes.push("unchanged");
        continue;
      }
      // The stronger source names it: what the person said, over what the data showed.
      const stronger = SOURCE_RANK[draft.source] > SOURCE_RANK[row.source as FactSource];
      const update = {
        confidence: step.confidence,
        lastConfirmed: now,
        evidenceCount: row.evidenceCount + (step.newEvidence ? 1 : 0),
        ...(stronger
          ? { source: draft.source, sourceRef: draft.sourceRef ?? null, label: draft.label }
          : step.newEvidence
            ? { sourceRef: draft.sourceRef ?? row.sourceRef }
            : {}),
      };
      await db.userFacts.updateMany({ where: { id: row.id }, data: update });
      held.set(draft.key, { ...row, ...update });
      outcomes.push(step.newEvidence ? "confirmed" : "unchanged");
    }
  }
  return outcomes;
}

export async function recordFact(
  userId: string,
  draft: FactDraft,
  options: Options = {},
): Promise<RecordOutcome> {
  const [outcome] = await recordFacts(userId, [draft], options);
  return outcome;
}

// What Jane knows now, the surest first: one per key, never what was forgotten or replaced.
export async function listFacts(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<KnownFact[]> {
  const rows = await scopedFor(userId, client).userFacts.findMany({
    where: { supersededById: null, source: { not: FORGOTTEN } },
    orderBy: [{ lastConfirmed: "desc" }, { id: "desc" }],
  });
  const seen = new Set<string>();
  const facts: KnownFact[] = [];
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const fact = toKnown(row);
    if (fact) facts.push(fact);
  }
  return facts.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

// --- For the code that reads them ----------------------------------------------------

const PERSON_SOURCES: ReadonlySet<FactSource> = new Set(["answer", "chat", "action"]);

// Profile facts the person told Jane or showed by what they did, sure enough to use, as the
// profile's "told" answers (src/profile/build.ts): the detectors then work from them, e.g.
// "I rent" in the chat with no rent payments in the data. Values that don't fit the fact's kind
// are left out. Data-read facts aren't: the profile reads the data itself, fresh.
export function toldFromFacts(facts: readonly KnownFact[]): Told {
  const told: Told = {};
  for (const f of facts) {
    if (!PERSON_SOURCES.has(f.source) || f.confidence < USE_FROM_CONFIDENCE) continue;
    if (!(FACT_KEYS as readonly string[]).includes(f.key)) continue;
    const spec = factSpec(f.key)!;
    const fits =
      spec.kind === "boolean"
        ? typeof f.value === "boolean"
        : spec.kind === "number" || spec.kind === "cents"
          ? typeof f.value === "number"
          : spec.kind === "choice"
            ? typeof f.value === "string" && (spec.choices ?? []).includes(f.value)
            : typeof f.value === "string";
    if (fits) told[f.key as FactKey] = f.value;
  }
  return told;
}

const SOURCE_WORDS: Record<FactSource, string> = {
  answer: "they told you",
  chat: "they said it in the chat",
  action: "from what they did with your suggestions",
  upload: "from their uploaded statements",
  detector: "from their bank data",
};

// What Jane knows, for the context of a chat answer: the surest facts, each with where it came
// from and how sure. Empty when nothing is known well enough.
export function memoryForChat(facts: readonly KnownFact[]): string {
  const usable = facts
    .filter((f) => f.confidence >= USE_FROM_CONFIDENCE)
    .slice(0, CHAT_MEMORY_FACTS);
  if (usable.length === 0) return "";
  return [
    "What you know about the person from earlier (their answers, the chat and their data; use it where it helps, never quote an old conversation, and if they say something has changed, go with what they say now):",
    ...usable.map((f) => `- ${f.label} (${SOURCE_WORDS[f.source]}; ${f.confidence}% sure)`),
  ].join("\n");
}

// --- The person's own changes ---------------------------------------------------------

// The preference a fact mirrors (src/lib/jane-agent/preferences.ts), so forgetting the fact
// forgets it there too: "preference:<kind>:<key>".
export const preferenceRef = (kind: string, key: string) => `preference:${kind}:${key}`;
function preferenceOf(ref: string | null): { kind: string; key: string } | null {
  const m = /^preference:([a-z]+):(.+)$/.exec(ref ?? "");
  return m ? { kind: m[1], key: m[2] } : null;
}
// Every preference that says what a fact says (src/lib/jane-agent/preferences.ts
// factFromPreference, the other way round).
function preferencesFor(key: string): { kind: string; key: string }[] {
  const [family, ...rest] = key.split(":");
  const tail = rest.join(":");
  if ((family === "never" || family === "style") && tail) return [{ kind: family, key: tail }];
  return [
    { kind: "fact", key },
    { kind: "fact", key: `profile:${key}` },
    ...(key === "monthly_income" ? [{ kind: "fact", key: "income" }] : []),
  ];
}

// What an audit entry says about a fact: its family ("goal", "habit", "housing"), never what
// was in it.
const familyOf = (key: string) => key.split(":")[0].slice(0, 40);

// Forgets one fact, with its history, and the preference it came from; data won't bring it
// back. False when it isn't theirs.
export async function forgetFact(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const row = await db.userFacts.findFirst({
    where: { id, source: { not: FORGOTTEN } },
    select: { key: true, source: true, sourceRef: true },
  });
  if (!row) return false;
  // Every preference saying the same thing: the one it came from, and any other for that fact.
  const from = preferenceOf(row.sourceRef);
  const prefs = [...(from ? [from] : []), ...preferencesFor(row.key)];
  await db.transaction(async (tx) => {
    await tx.userFacts.deleteMany({ where: { key: row.key } });
    await tx.userFacts.create({
      data: {
        userId,
        key: row.key,
        value: {},
        label: "",
        source: FORGOTTEN,
        confidence: 0,
        firstSeen: now,
        lastConfirmed: now,
      },
    });
    await tx.janePreferences.deleteMany({ where: { OR: prefs } });
  });
  await logAudit(
    { type: "user", id: userId },
    "memory_fact_deleted",
    { type: "user", id: userId },
    { family: familyOf(row.key), source: row.source },
  );
  return true;
}

// Forgets what the preference said, when the person deletes the preference itself.
export async function forgetFactsFrom(
  userId: string,
  ref: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).userFacts.deleteMany({ where: { sourceRef: ref } });
}

export class MemoryError extends Error {}

// What a correction would say: the person's words, in the shape of what's known.
function parseCorrection(fact: KnownFact, raw: string): FactValue {
  const text = raw.trim();
  if (text === "") throw new MemoryError("Type an answer first.");
  if (typeof fact.value === "boolean") {
    if (/^(yes|true|y)$/i.test(text)) return true;
    if (/^(no|false|n)$/i.test(text)) return false;
    throw new MemoryError("Answer yes or no.");
  }
  if (typeof fact.value === "number") {
    const n = Number(text.replace(/[$,]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new MemoryError("Type a number.");
    return n;
  }
  return text.slice(0, FACT_TEXT_MAX);
}

// How a corrected fact reads, for keys that aren't profile facts.
const FAMILY_LABEL: Record<string, string> = {
  payday: "Payday",
  main_bank: "Your main bank",
  rent_payee: "Your rent goes to",
  card_habit: "How you use your cards",
  goal: "Your goal",
  household_note: "Your household",
  prefers_diy: "You'd rather do things yourself",
};

// The person corrects a fact: what they say now is what Jane knows, as sure as it gets. A
// profile fact goes through the profile's own correction (src/lib/profile.ts), so the older
// answers it stands for agree. Throws MemoryError with a plain message.
export async function correctFact(
  userId: string,
  id: string,
  raw: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const fact = (await listFacts(userId, { client })).find((f) => f.id === id);
  if (!fact) throw new MemoryError("That's not there anymore.");
  const spec = factSpec(fact.key);
  if (spec && !spec.correctable) throw new MemoryError("That one comes from your bank.");
  if (spec) {
    const profile = await import("@/lib/profile");
    let value: FactValue;
    try {
      value = profile.parseAnswer(fact.key, raw);
    } catch (error) {
      if (error instanceof profile.ProfileError) throw new MemoryError(error.message);
      throw error;
    }
    const label = `${spec.label}: ${profile.sayFact(fact.key as FactKey, value)}`;
    if (isSensitiveFact({ key: fact.key, label, value })) {
      throw new MemoryError("Jane doesn't keep that kind of detail.");
    }
    await profile.correctFact(userId, fact.key, raw, { client, now });
  } else {
    const value = parseCorrection(fact, raw);
    const family = familyOf(fact.key);
    const label =
      typeof value === "boolean"
        ? `${FAMILY_LABEL[family] ?? fact.label}: ${value ? "yes" : "no"}`
        : `${FAMILY_LABEL[family] ?? "You told Jane"}: ${value}`;
    const outcome = await recordFact(
      userId,
      { key: fact.key, value, label, source: "answer", sourceRef: "settings" },
      { client, now },
    );
    if (outcome === "blocked") throw new MemoryError("Jane doesn't keep that kind of detail.");
  }
  // The correction is what's known, at full confidence.
  await scopedFor(userId, client).userFacts.updateMany({
    where: { key: fact.key, supersededById: null, source: "answer" },
    data: { confidence: MAX_CONFIDENCE },
  });
  await logAudit(
    { type: "user", id: userId },
    "memory_fact_corrected",
    { type: "user", id: userId },
    { family: familyOf(fact.key), source: fact.source },
  );
}

// "Delete all memory": every fact, every preference Jane kept, and the stored conversations
// (what the person typed and Jane's answers, and Ask Jane's). Jane's own posts stay: what's
// waiting on the person, and what was decided. Returns how many of each went.
export async function forgetEverything(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ facts: number; preferences: number; messages: number; conversations: number }> {
  const db = scopedFor(userId, client);
  const counts = await db.transaction(async (tx) => {
    const facts = await tx.userFacts.deleteMany({});
    const preferences = await tx.janePreferences.deleteMany({});
    const messages = await tx.janeMessages.deleteMany({
      where: { kind: { in: ["user", "reply"] } },
    });
    const conversations = await tx.askConversations.deleteMany({});
    return {
      facts: facts.count,
      preferences: preferences.count,
      messages: messages.count,
      conversations: conversations.count,
    };
  });
  await logAudit(
    { type: "user", id: userId },
    "memory_deleted_all",
    { type: "user", id: userId },
    counts,
  );
  return counts;
}
