import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// What Jane remembers about the person (spec step 91), in jane_preferences. Only ever saved
// on the person's own tap: "Don't suggest again" on a suggestion, or "Remember this" under
// something they told her in the chat. Jane's brain, her answers and every sector read them
// through the helpers here; Settings lists them, each deletable.
//
// Keys: kind "never" is a suggestion not to make again: "finding:<the finding's key>" or
// "message:<a message's dedupeKey>". kind "fact" is something they said: "payday" (value
// { days: [1, 15] }), "keep:<name>" ("I need my car", value { target }), "note:<words>".

export type PreferenceKind = "never" | "fact";

export type Preference = {
  id: string;
  kind: PreferenceKind;
  key: string;
  value: Record<string, unknown>;
  label: string;
  createdAt: Date;
};

// What a tap would save, carried on the message offering it (refs.preference).
export type PreferenceDraft = Pick<Preference, "kind" | "key" | "value" | "label">;

type Options = { client?: PrismaClient };

const LABEL_MAX = 200;
const isObject = (v: unknown): v is Record<string, unknown> =>
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
    r.kind === "never" || r.kind === "fact"
      ? [{ ...r, kind: r.kind, value: isObject(r.value) ? r.value : {} }]
      : [],
  );
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
  await logAudit({ type: "user", id: userId }, "preference_saved", { type: "user", id: userId }, {
    kind: draft.kind,
  });
}

// False when it isn't theirs or is already gone.
export async function deletePreference(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).janePreferences.deleteMany({ where: { id } });
  if (count > 0) {
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

// What they said they need or want to keep ("car", "netflix"): never suggested cutting.
export const keeps = (prefs: readonly Preference[]) =>
  prefs.flatMap((p) =>
    p.kind === "fact" && p.key.startsWith("keep:") && typeof p.value.target === "string"
      ? [p.value.target]
      : [],
  );
