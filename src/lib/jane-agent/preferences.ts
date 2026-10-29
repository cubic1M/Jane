import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  forgetFactsFrom,
  preferenceRef,
  recordFact,
  type FactDraft,
  type FactValue,
} from "@/lib/memory/facts";

// What Jane remembers about the person (spec step 91), in jane_preferences. Only ever saved
// on the person's own tap: "Don't suggest again" on a suggestion, or "Remember this" under
// something they told it in the chat. Jane's brain, its answers and every sector read them
// through the helpers here; Settings lists them, each deletable.
//
// Keys: kind "never" is a suggestion not to make again: "finding:<the finding's key>" or
// "message:<a message's dedupeKey>". kind "fact" is something they said: "payday" (value
// { days: [1, 15] }), "keep:<name>" ("I need my car", value { target }), "note:<words>".
// kind "style" is how they like Jane to talk and post (spec steps 184 and 188): "posting"
// (value { posting: "daily" | "as_they_come" }).

export type PreferenceKind = "never" | "fact" | "style";

// Plain JSON, so it can sit on a message's refs.
export type PreferenceValue = { [key: string]: string | number | boolean | number[] };

export type Preference = {
  id: string;
  kind: PreferenceKind;
  key: string;
  value: PreferenceValue;
  label: string;
  createdAt: Date;
};

// What a tap would save, carried on the message offering it (refs.preference).
export type PreferenceDraft = Pick<Preference, "kind" | "key" | "value" | "label">;

type Options = { client?: PrismaClient };

const LABEL_MAX = 200;
const isObject = (v: unknown): v is PreferenceValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function listPreferences(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Preference[]> {
  const rows = await scopedFor(userId, client).janePreferences.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, key: true, value: true, label: true, createdAt: true },
  });
  return rows.flatMap((r) =>
    r.kind === "never" || r.kind === "fact" || r.kind === "style"
      ? [{ ...r, kind: r.kind, value: isObject(r.value) ? r.value : {} }]
      : [],
  );
}

// The fact a preference stands for in what Jane knows (src/lib/memory/): a profile correction is
// that profile fact, "Don't suggest again" is what the person did, the rest is their answer.
export function factFromPreference(draft: PreferenceDraft): FactDraft {
  const v = draft.value;
  const pick = (x: unknown): FactValue | undefined =>
    typeof x === "string" || typeof x === "number" || typeof x === "boolean" ? x : undefined;
  const value: FactValue =
    pick(v.value) ??
    pick(v.target) ??
    pick(v.text) ??
    (Array.isArray(v.days) ? v.days.join(",") : undefined) ??
    Object.values(v)
      .map(pick)
      .find((x) => x !== undefined) ??
    true;
  const key =
    draft.kind === "fact"
      ? draft.key.startsWith("profile:")
        ? draft.key.slice("profile:".length)
        : draft.key === "income"
          ? "monthly_income"
          : draft.key
      : `${draft.kind}:${draft.key}`;
  return {
    key,
    value,
    label: draft.label,
    source: draft.kind === "never" ? "action" : "answer",
    sourceRef: preferenceRef(draft.kind, draft.key),
  };
}

// Saves it (or replaces what was saved under the same key, like a new payday).
export async function savePreference(
  userId: string,
  draft: PreferenceDraft,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const data = {
    value: draft.value as Prisma.InputJsonObject,
    label: draft.label.slice(0, LABEL_MAX),
  };
  await client.janePreference.upsert({
    where: { userId_kind_key: { userId, kind: draft.kind, key: draft.key } },
    create: { userId, kind: draft.kind, key: draft.key, ...data },
    update: data,
  });
  // What Jane knows takes it as the person's word.
  await recordFact(userId, factFromPreference(draft), { client }).catch((error) =>
    console.error("Couldn't add a preference to what Jane knows", { error: String(error) }),
  );
  await logAudit(
    { type: "user", id: userId },
    "preference_saved",
    { type: "user", id: userId },
    {
      kind: draft.kind,
    },
  );
}

// False when it isn't theirs or is already gone.
export async function deletePreference(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const row = await db.janePreferences.findFirst({
    where: { id },
    select: { kind: true, key: true },
  });
  const { count } = await db.janePreferences.deleteMany({ where: { id } });
  if (count > 0) {
    // And what Jane knew from it.
    if (row) await forgetFactsFrom(userId, preferenceRef(row.kind, row.key), { client });
    await logAudit(
      { type: "user", id: userId },
      "preference_deleted",
      { type: "user", id: userId },
      {},
    );
  }
  return count > 0;
}

// --- For the code that reads them ----------------------------------------------------

// Spec step 184: how often Jane posts. "daily" (the default) is the day in one agenda
// message plus whatever is urgent; "as_they_come" is each thing as its own message.
export type Posting = "daily" | "as_they_come";
export function postingOf(prefs: readonly Preference[]): Posting {
  const style = prefs.find((p) => p.kind === "style" && p.key === "posting");
  return style?.value.posting === "as_they_come" ? "as_they_come" : "daily";
}
export const AS_THEY_COME: PreferenceDraft = {
  kind: "style",
  key: "posting",
  value: { posting: "as_they_come" },
  label: "Tell me things as they come, not in one morning message",
};

// Suggestions not to make again, by key.
export const neverKeys = (prefs: readonly Preference[]) =>
  new Set(prefs.filter((p) => p.kind === "never").map((p) => p.key));

// Days of the month they said they're paid, or null.
export function paydayDays(prefs: readonly Preference[]): number[] | null {
  const fact = prefs.find((p) => p.kind === "fact" && p.key === "payday");
  const days = Array.isArray(fact?.value.days) ? fact.value.days : [];
  const valid = days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 31);
  return valid.length > 0 ? [...valid].sort((a, b) => a - b) : null;
}

// Spec step 239: what they said they earn a month ("that's wrong" on an income figure), in
// cents, or null. Every sector that works from income reads this instead of the average.
export function incomeOverride(prefs: readonly Preference[]): number | null {
  const fact = prefs.find((p) => p.kind === "fact" && p.key === "income");
  const cents = fact?.value.monthlyCents;
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0
    ? Math.round(cents)
    : null;
}

// What they said they need or want to keep ("car", "netflix"): never suggested cutting.
export const keeps = (prefs: readonly Preference[]) =>
  prefs.flatMap((p) =>
    p.kind === "fact" && p.key.startsWith("keep:") && typeof p.value.target === "string"
      ? [p.value.target]
      : [],
  );
