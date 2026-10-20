import type { PrismaClient } from "@/generated/prisma/client";
import { PROFILE_MONTHS } from "@/config/profile";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { deletePreference, savePreference } from "@/lib/jane-agent/preferences";
import { buildProfile, type Profile, type ProfileInput, type Told } from "@/profile/build";
import { FACT_KEYS, type FactKey, factSpec } from "@/profile/facts";

// The picture of you (spec step 253), loaded for one person: what the bank shows, what they
// told Jane here and what they answered elsewhere (their tax, insurance and investor
// answers), so every sector reads one profile instead of its own guesses. A correction is
// saved as a Jane preference (kind "fact", key "profile:<fact>"), which Settings lists and
// the person can delete, and is also written to the older answer it replaces so the code
// that still reads that sees the same.

type Options = { client?: PrismaClient; now?: Date };

const PREF_PREFIX = "profile:";
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// The raw rows a profile is built from, with what the person told Jane. Detectors (spec step
// 254) get these beside the profile, for the figures that are theirs ("you pay $1,240").
export async function loadProfileInput(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ProfileInput> {
  const db = scopedFor(userId, client);
  const today = dayOf(now);
  const since = new Date(now.getTime() - (PROFILE_MONTHS * 31 + 2) * 86_400_000);
  const [transactions, accounts, liabilities, prefs, tax, insurance, investor] = await Promise.all([
    db.transactions.findMany({
      where: { date: { gt: since, lte: now } },
      select: {
        date: true,
        amountCents: true,
        description: true,
        pfcDetailed: true,
        accountId: true,
      },
    }),
    db.accounts.findMany({
      select: { id: true, type: true, subtype: true, currentBalanceCents: true },
    }),
    db.liabilities.findMany({
      select: { accountId: true, kind: true, aprBps: true, hasPmi: true, payoffDate: true },
    }),
    db.janePreferences.findMany({
      where: { kind: "fact", key: { startsWith: PREF_PREFIX } },
      select: { key: true, value: true },
    }),
    db.taxProfiles.findFirst({
      select: { filingStatus: true, childrenUnder17: true, otherDependants: true, answered: true },
    }),
    db.insuranceProfiles.findFirst({ select: { housing: true } }),
    db.investorProfiles.findFirst({ select: { age: true, ageOn: true, dropReaction: true } }),
  ]);

  // Answers given elsewhere come first; a correction made here wins over them.
  const told: Told = {};
  if (tax?.answered.includes("dependants")) {
    const kids = (tax.childrenUnder17 ?? 0) + (tax.otherDependants ?? 0);
    told.has_children = kids > 0;
  }
  if (tax?.filingStatus?.startsWith("married") && told.has_children !== true)
    told.household = "couple";
  if (insurance?.housing === "own" || insurance?.housing === "rent")
    told.housing = insurance.housing;
  if (investor?.age != null) {
    const years = investor.ageOn
      ? Math.floor((now.getTime() - investor.ageOn.getTime()) / (365.25 * 86_400_000))
      : 0;
    told.age = investor.age + Math.max(0, years);
  }
  if (investor?.dropReaction) told.risk = investor.dropReaction;
  for (const p of prefs) {
    const key = p.key.slice(PREF_PREFIX.length);
    const value = (p.value as { value?: unknown } | null)?.value;
    if (
      (FACT_KEYS as readonly string[]).includes(key) &&
      ["string", "number", "boolean"].includes(typeof value)
    ) {
      told[key as FactKey] = value as string | number | boolean;
    }
  }

  return {
    today,
    transactions: transactions.map((t) => ({
      date: dayOf(t.date),
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents ?? 0,
    })),
    liabilities: liabilities.map((l) => ({
      accountId: l.accountId,
      kind: l.kind,
      aprBps: l.aprBps,
      hasPmi: l.hasPmi,
      payoffDate: l.payoffDate ? dayOf(l.payoffDate) : null,
    })),
    told,
  };
}

export async function loadProfile(userId: string, options: Options = {}): Promise<Profile> {
  return buildProfile(await loadProfileInput(userId, options));
}

export class ProfileError extends Error {}

// Checks a typed answer against the fact's kind. Throws ProfileError with a plain message.
export function parseAnswer(key: string, raw: string): string | number | boolean {
  const spec = factSpec(key);
  if (!spec || !spec.correctable) throw new ProfileError("That one can't be changed here.");
  const text = raw.trim();
  if (text === "") throw new ProfileError("Type an answer first.");
  switch (spec.kind) {
    case "boolean":
      if (/^(yes|true|y)$/i.test(text)) return true;
      if (/^(no|false|n)$/i.test(text)) return false;
      throw new ProfileError("Answer yes or no.");
    case "choice": {
      const choice = text.toLowerCase();
      if (spec.choices?.includes(choice)) return choice;
      throw new ProfileError(`Pick one of: ${spec.choices?.join(", ")}.`);
    }
    case "number":
    case "cents": {
      const n = Number(text.replace(/[$,]/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new ProfileError("Type a number.");
      return spec.kind === "cents" ? Math.round(n * 100) : Math.round(n);
    }
    default:
      return text.slice(0, 120);
  }
}

const say = (key: string, value: string | number | boolean) => {
  const spec = factSpec(key)!;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return spec.kind === "cents" ? dollars(Number(value)) : String(value);
};

// The person corrects a fact. It is saved as theirs (a "told" fact at 100%), and written to
// the older answer it replaces, so every reader agrees.
export async function correctFact(
  userId: string,
  key: string,
  raw: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const value = parseAnswer(key, raw);
  const spec = factSpec(key)!;
  await savePreference(
    userId,
    {
      kind: "fact",
      key: `${PREF_PREFIX}${key}`,
      value: { value },
      label: `${spec.label}: ${say(key, value)}`,
    },
    { client },
  );
  if (key === "housing" && (value === "own" || value === "rent")) {
    await client.insuranceProfile.upsert({
      where: { userId },
      create: { userId, housing: value },
      update: { housing: value },
    });
  }
  if (key === "age" && typeof value === "number") {
    await client.investorProfile.upsert({
      where: { userId },
      create: { userId, age: value, ageOn: now },
      update: { age: value, ageOn: now },
    });
  }
  if (key === "has_children" && typeof value === "boolean") {
    const existing = await client.taxProfile.findUnique({
      where: { userId },
      select: { childrenUnder17: true, answered: true },
    });
    const answered = [...new Set([...(existing?.answered ?? []), "dependants"])];
    const children = value ? Math.max(existing?.childrenUnder17 ?? 0, 1) : 0;
    await client.taxProfile.upsert({
      where: { userId },
      create: { userId, childrenUnder17: children, answered },
      update: { childrenUnder17: children, answered },
    });
  }
}

// Takes a correction back, so Jane goes back to what she sees.
export async function clearCorrection(
  userId: string,
  key: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "fact", key: `${PREF_PREFIX}${key}` },
    select: { id: true },
  });
  return row ? deletePreference(userId, row.id, { client }) : false;
}

// How a fact reads aloud.
export function sayFact(key: FactKey, value: string | number | boolean | null): string {
  if (value === null) return "not known yet";
  return say(key, value);
}
