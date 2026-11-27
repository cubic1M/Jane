import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { RESIDENCY_FROM_TOLD, type TaxFactKey } from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadFiling } from "@/lib/filing-status";
import { listFacts, toldFromFacts, type KnownFact } from "@/lib/memory/facts";
import { localDate, timezoneOf } from "@/lib/today";
import { parseChildren } from "@/planning/family-taxes";
import { defaultTaxYear } from "@/planning/tax-pack";
import type { FoundFacts } from "@/planning/tax-profile";
import type { TaxFactInput, TaxFactValue } from "@/lib/tax-facts/write";

// Read-repair (tax roadmap 1.3, step T9): what the person has already told Jane in the older stores
// (the tax profile's row, the told facts the question cards save, the investor profile) as rows of
// the household record. Nothing is lost and nothing is guessed: only what the person answered is
// copied (origin "legacy", or "answer" for a told fact). What Jane merely found in the accounts is
// worked out again on every load (foundRows) and never stored, so it cannot go stale.

const TOLD_PREFIX = "profile:";

export type LegacyMember = { memberKey: string; label: string; relationship: string };

export type LegacyRows = { facts: TaxFactInput[]; members: LegacyMember[] };

// A told answer and the person's own day it was given.
export type ToldAnswer = { value: TaxFactValue; day: string };

export type LegacySources = {
  taxYear: number;
  // The person's own day: stands in for an answer's day when an old store has no time.
  today: string;
  // How they file, settled by filingStatusFor (src/lib/filing-status.ts): the answer that counts,
  // the one that lost, and the day of the one that counts.
  filing: { status: FilingStatus; replaced: FilingStatus | null; day: string } | null;
  // The tax profile's row.
  profile: {
    answered: readonly string[];
    state: string | null;
    childrenUnder17: number | null;
    otherDependants: number | null;
    familyChildren: unknown;
    spouseWagesCents: number | null;
    studentYearsBefore: number | null;
    studentHalfTime: boolean | null;
  } | null;
  // Told facts by name ("has_children", "tax_residency"...), from the question cards and the chat.
  told: Readonly<Record<string, ToldAnswer | undefined>>;
  investor: { age: number | null; ageOn: string | null } | null;
};

const year = (day: string) => Number(day.slice(0, 4));

// An age on a day is a birth year between two: "1998/1999".
const birthYears = (age: number, day: string) => `${year(day) - age - 1}/${year(day) - age}`;

// A told fact (what a question card or the chat saved, by its name in src/profile/facts.ts) as the
// record's rows for a tax year: the person's answer, on the day they gave it. A fact the record has
// no key for, or a value outside the fact's choices, gives none. Shared by read-repair and by the
// writers that keep the record in step (src/lib/profile.ts).
export function factsFromTold(name: string, a: ToldAnswer, taxYear: number): TaxFactInput[] {
  const base = {
    taxYear,
    origin: "answer",
    asOf: a.day,
    sourceRef: `question:${name}`,
  } as const;
  const text = String(a.value);
  switch (name) {
    case "claimed_as_dependent":
      return ["yes", "no", "unsure"].includes(text)
        ? [{ ...base, key: "filing.claimed_as_dependent", value: text }]
        : [];
    case "tax_residency":
      return RESIDENCY_FROM_TOLD[text]
        ? [{ ...base, key: "residency.status", value: RESIDENCY_FROM_TOLD[text] }]
        : [];
    case "enrollment": {
      const halfTime = text === "undergrad" || text === "grad";
      if (!halfTime && text !== "less_than_half" && text !== "not_enrolled") return [];
      return [
        { ...base, key: "person.half_time", value: halfTime },
        ...(halfTime ? [{ ...base, key: "person.degree_program", value: text } as const] : []),
      ];
    }
    case "age":
      return typeof a.value === "number" && a.value > 0
        ? [
            {
              ...base,
              key: "person.birth_date",
              value: birthYears(a.value, a.day),
              status: "inferred",
              confidence: 90,
            },
          ]
        : [];
    case "home_state":
      return typeof a.value === "string" ? [{ ...base, key: "home.state", value: a.value }] : [];
    default:
      return [];
  }
}

// Who a member of the household is. A child the family form has an id for is `child:<id>`, an id
// written once and never changed, so removing one child never hands its facts to the next. A child
// the person only counted ("2 children under 17") has no details to keep apart, so is `child:count-N`
// and the others `relative:count-N`. `child:pos-N` is a child whose id has not been written yet,
// worked out in memory only. Never stored: `child:found-N`, what Jane saw in the accounts.
export const isProfileMember = (key: string) =>
  /^(child:(c_[0-9a-f]{12}|count-\d+|pos-\d+)|relative:count-\d+)$/.test(key);

// The facts the older stores own until the record takes over: read-repair keeps these (and the
// details of the profile's own members) in step with them, and drops a row the stores no longer say.
export const OLD_STORE_KEYS: readonly TaxFactKey[] = [
  "filing.status",
  "filing.claimed_as_dependent",
  "residency.status",
  "person.half_time",
  "person.degree_program",
  "person.birth_date",
  "home.state",
  "spouse.earned_income",
  "person.postsecondary_years_before",
  "household.dependants_stated",
];
export const OLD_STORE_MEMBER_KEYS: readonly TaxFactKey[] = [
  "member.birth_date",
  "member.months_lived_with_you",
  "member.ssn_valid_for_work",
];

// The household as the tax profile holds it: counts of children and other dependants, and the
// family details (age, months at home, Social Security number or not) for each child. Members keep
// the same keys every time, so copying twice, or writing the profile again, changes nothing.
export function householdRows(
  profile: { childrenUnder17: number; otherDependants: number; familyChildren: unknown },
  taxYear: number,
  today: string,
): LegacyRows {
  // The tax profile has no year: its family details describe the year being worked on. A child's
  // birth year is worked out from that year whichever year the record is read for, so one child has
  // one birth year; the months at home and the like are copied only into the year they describe.
  const workingYear = defaultTaxYear(today);
  const facts: TaxFactInput[] = [];
  const members: LegacyMember[] = [];
  const children = parseChildren(profile.familyChildren);
  const kids = Math.max(profile.childrenUnder17, children.length);
  for (let i = 0; i < kids; i += 1) {
    const child = children[i];
    const memberKey = !child
      ? `child:count-${i + 1}`
      : child.id
        ? `child:${child.id}`
        : `child:pos-${i + 1}`;
    members.push({ memberKey, label: `Child ${i + 1}`, relationship: "child" });
    if (!child) continue;
    const m = {
      taxYear,
      origin: "legacy",
      member: memberKey,
      asOf: today,
      sourceRef: "tax_profile.family_children",
    } as const;
    if (taxYear === workingYear) {
      facts.push({ ...m, key: "member.months_lived_with_you", value: child.monthsLivedWithYou });
      facts.push({ ...m, key: "member.ssn_valid_for_work", value: child.hasSsn ? "yes" : "no" });
    }
    if (!child.ageUnknown)
      facts.push({
        ...m,
        key: "member.birth_date",
        value: String(workingYear - child.ageAtYearEnd),
        status: "inferred",
      });
  }
  for (let i = 0; i < profile.otherDependants; i += 1)
    members.push({
      memberKey: `relative:count-${i + 1}`,
      label: `Dependant ${i + 1}`,
      relationship: "other_relative",
    });
  facts.push({
    key: "household.dependants_stated",
    value: true,
    taxYear,
    origin: "legacy",
    asOf: today,
    sourceRef: "tax_profile",
  });
  return { facts, members };
}

export function legacyRows(s: LegacySources): LegacyRows {
  const facts: TaxFactInput[] = [];
  const members: LegacyMember[] = [];
  const add = (
    key: TaxFactKey,
    value: TaxFactValue,
    o: Omit<TaxFactInput, "key" | "value" | "taxYear" | "origin"> & {
      origin?: "answer" | "legacy";
    },
  ) => facts.push({ key, value, taxYear: s.taxYear, origin: o.origin ?? "legacy", ...o });
  const told = (name: string) => s.told[name];

  if (s.filing) {
    add("filing.status", s.filing.status, {
      origin: "answer",
      asOf: s.filing.day,
      sourceRef: "question:filing_status",
    });
    // The answer that lost is kept beside it, so the disagreement is on the record.
    if (s.filing.replaced)
      add("filing.status", s.filing.replaced, { origin: "legacy", asOf: s.today });
  }
  for (const [name, answer] of Object.entries(s.told)) {
    if (answer) facts.push(...factsFromTold(name, answer, s.taxYear));
  }
  const t = { children: told("has_children") };

  const p = s.profile;
  const yours = (field: string) => p?.answered.includes(field) ?? false;
  if (p && yours("state") && p.state) add("home.state", p.state, { asOf: s.today });
  // The family details have no year: they describe the year being worked on, so only that year's
  // record gets them.
  const working = s.taxYear === defaultTaxYear(s.today);
  if (working && p?.spouseWagesCents != null)
    add("spouse.earned_income", p.spouseWagesCents, { asOf: s.today });
  if (working && p?.studentYearsBefore != null)
    add("person.postsecondary_years_before", p.studentYearsBefore, { asOf: s.today });
  if (working && p?.studentHalfTime != null)
    add("person.half_time", p.studentHalfTime, { asOf: s.today });
  if (s.investor?.age && s.investor.age > 0) {
    const day = s.investor.ageOn ?? s.today;
    add("person.birth_date", birthYears(s.investor.age, day), {
      status: "inferred",
      asOf: day,
      sourceRef: "investor_profile",
    });
  }

  // The household: the children and other dependants the person gave (with the family details'
  // ages), then "I have children" with no number. Each member's key is fixed, so the copy is the
  // same however many times it is made.
  const withDetails = parseChildren(p?.familyChildren).length > 0;
  if (p && (yours("dependants") || withDetails)) {
    const counted = yours("dependants");
    const household = householdRows(
      {
        childrenUnder17: counted ? (p.childrenUnder17 ?? 0) : 0,
        otherDependants: counted ? (p.otherDependants ?? 0) : 0,
        familyChildren: p.familyChildren,
      },
      s.taxYear,
      s.today,
    );
    facts.push(...household.facts);
    members.push(...household.members);
  } else if (t.children) {
    add("household.dependants_stated", true, {
      origin: "answer",
      asOf: t.children.day,
      sourceRef: "question:has_children",
    });
    if (t.children.value === true)
      members.push({ memberKey: "child:count-1", label: "Child 1", relationship: "child" });
  }
  return { facts, members };
}

// What Jane found in the person's accounts, as rows that are never stored: the loader uses one only
// where nothing stored speaks for that fact. Inferred, from the data.
export function foundRows(found: FoundFacts, taxYear: number, today: string): LegacyRows {
  const facts: TaxFactInput[] = [];
  const members: LegacyMember[] = [];
  const base = { taxYear, asOf: today, status: "inferred", origin: "transaction" } as const;
  if (found.state)
    facts.push({
      ...base,
      key: "home.state",
      value: found.state.code,
      sourceRef: found.state.from,
    });
  const d = found.dependants;
  if (d)
    for (let i = 0; i < d.childrenUnder17 + d.otherDependants; i += 1)
      members.push(
        i < d.childrenUnder17
          ? { memberKey: `child:found-${i + 1}`, label: `Child ${i + 1}`, relationship: "child" }
          : {
              memberKey: `relative:found-${i + 1}`,
              label: `Dependant ${i + 1}`,
              relationship: "other_relative",
            },
      );
  return { facts, members };
}

type ToldPreference = { key: string; value: unknown; createdAt: Date };

const readToldPreferences = (userId: string, client: PrismaClient): Promise<ToldPreference[]> =>
  scopedFor(userId, client).janePreferences.findMany({
    where: { kind: "fact", key: { startsWith: TOLD_PREFIX } },
    select: { key: true, value: true, createdAt: true },
  });

// What the person told Jane, by fact name: what Jane remembers from the chat comes first, a
// correction made on the card wins over it, as the profile reads it (src/lib/profile.ts). A card's
// preference keeps the day it was first saved when its answer is changed, so the day of an answer
// is the later of that and the day memory last confirmed the same value.
function toldFrom(
  prefs: readonly ToldPreference[],
  memory: readonly KnownFact[],
  timezone: string,
): Record<string, ToldAnswer> {
  const day = (at: Date) => localDate(at, timezone);
  const told: Record<string, ToldAnswer> = {};
  const remembered = toldFromFacts(memory) as Record<string, unknown>;
  for (const f of memory) {
    const value = remembered[f.key];
    if (value !== undefined)
      told[f.key] = { value: value as TaxFactValue, day: day(f.lastConfirmed) };
  }
  for (const p of prefs) {
    const name = p.key.slice(TOLD_PREFIX.length);
    const value = (p.value as { value?: unknown } | null)?.value;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    const confirmed = memory.find((f) => f.key === name && f.value === value)?.lastConfirmed;
    const at = confirmed && confirmed > p.createdAt ? confirmed : p.createdAt;
    told[name] = { value: value as TaxFactValue, day: day(at) };
  }
  return told;
}

// What the person has told Jane now, from the card and from memory (for the writers that keep the
// record in step).
export async function loadToldAnswers(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Record<string, ToldAnswer>> {
  const [prefs, memory, timezone] = await Promise.all([
    readToldPreferences(userId, client),
    listFacts(userId, { client }),
    timezoneOf(userId, { client }),
  ]);
  return toldFrom(prefs, memory, timezone);
}

// The person's old stores, read for one tax year. Always for one person, through scopedFor.
export async function readLegacySources(
  userId: string,
  taxYear: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date },
): Promise<LegacySources> {
  const db = scopedFor(userId, client);
  const timezone = await timezoneOf(userId, { client });
  const day = (at: Date | null | undefined) => (at ? localDate(at, timezone) : null);
  const today = localDate(now, timezone);
  const [filing, prefs, memory, row, investor] = await Promise.all([
    loadFiling(userId, { client }),
    readToldPreferences(userId, client),
    listFacts(userId, { client }),
    db.taxProfiles.findFirst({
      select: {
        answered: true,
        state: true,
        childrenUnder17: true,
        otherDependants: true,
        familyChildren: true,
        spouseWagesCents: true,
        studentYearsBefore: true,
        studentHalfTime: true,
      },
    }),
    db.investorProfiles.findFirst({ select: { age: true, ageOn: true } }),
  ]);
  const told = toldFrom(prefs, memory, timezone);
  const settled = filing.read;
  const counted = settled.source === "told" || settled.source === "profile";
  const settledAt = settled.source === "told" ? filing.told?.at : filing.stored?.at;
  const sources: LegacySources = {
    taxYear,
    today,
    filing:
      counted && isFilingStatus(settled.status)
        ? {
            status: settled.status,
            replaced: settled.replaced,
            day:
              day(settledAt) ??
              day(prefs.find((p) => p.key === `${TOLD_PREFIX}filing_status`)?.createdAt) ??
              today,
          }
        : null,
    profile: row,
    told,
    investor: investor ? { age: investor.age, ageOn: day(investor.ageOn) } : null,
  };
  return sources;
}
