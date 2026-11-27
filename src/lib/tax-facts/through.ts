import { isFilingStatus } from "@/config/tax";
import type { TaxFactKey } from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadFiling } from "@/lib/filing-status";
import { factsFromTold, householdRows, loadToldAnswers } from "@/lib/tax-facts/legacy";
import {
  forgetMemberDetailsExcept,
  forgetTaxFact,
  recordTaxFact,
  syncProfileMembers,
  type TaxFactInput,
  type TaxFactValue,
} from "@/lib/tax-facts/write";
import { log } from "@/lib/log";
import { todayOf } from "@/lib/today";
import { parseChildren } from "@/planning/family-taxes";
import { defaultTaxYear } from "@/planning/tax-pack";

// Keeping the household record in step with the older stores (tax roadmap 1.3, step T9). Every
// writer of an older store calls one of these after it has written, so the old store is never
// written less than before; the record gets the same answer as the person's own (origin "answer"),
// for the tax year the person is working on (defaultTaxYear of their own day). A failure here is
// logged and does not undo the answer the person has just given: the older store still has it.

type Options = { client?: PrismaClient; now?: Date };

const PROFILE_ANSWER = "tax_profile";

// What a told fact wrote to the record (src/lib/tax-facts/legacy.ts factsFromTold).
const KEYS_OF_TOLD: Readonly<Record<string, readonly TaxFactKey[]>> = {
  claimed_as_dependent: ["filing.claimed_as_dependent"],
  tax_residency: ["residency.status"],
  enrollment: ["person.half_time", "person.degree_program"],
  age: ["person.birth_date"],
  home_state: ["home.state"],
};

async function context(userId: string, { client = defaultClient, now = new Date() }: Options) {
  const today = await todayOf(userId, { client, now });
  return { client, now, today, taxYear: defaultTaxYear(today) };
}

// The person's answer on the record. The copy read-repair made of the same older store (origin
// "legacy") described what that store held before this write, so it goes: left, it would read as a
// disagreement that no longer exists.
async function answer(userId: string, input: TaxFactInput, options: Required<Options>) {
  await recordTaxFact(userId, { ...input, origin: "answer" }, options);
  await forgetTaxFact(userId, { ...input, origin: "legacy" }, options);
}

// The answer taken back, and the older store's copy of it with it.
async function retract(
  userId: string,
  input: { key: TaxFactKey; taxYear: number; member?: string },
  options: Required<Options>,
) {
  await forgetTaxFact(userId, { ...input, origin: "answer" }, options);
  await forgetTaxFact(userId, { ...input, origin: "legacy" }, options);
}

async function safely(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    log.error("tax household: the record was not updated", {
      what,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

// How they file: whatever the older stores settle on now (src/lib/filing-status.ts) is the answer on
// the record; with no answer left in either, the record has none either.
export async function syncFilingRecord(userId: string, options: Options = {}): Promise<void> {
  await safely("filing.status", async () => {
    const { client, now, taxYear } = await context(userId, options);
    const { read } = await loadFiling(userId, { client });
    const said =
      (read.source === "told" || read.source === "profile") && isFilingStatus(read.status);
    if (said) {
      await answer(
        userId,
        {
          key: "filing.status",
          value: read.status,
          taxYear,
          origin: "answer",
          sourceRef: "question:filing_status",
        },
        { client, now },
      );
      // Two answers the stores still disagree on: the one that lost stays beside it.
      if (read.replaced)
        await recordTaxFact(
          userId,
          { key: "filing.status", value: read.replaced, taxYear, origin: "legacy" },
          { client, now },
        );
    } else {
      await retract(userId, { key: "filing.status", taxYear }, { client, now });
    }
  });
}

// A told fact the question card or the chat saved ("tax_residency", "has_children"...).
export async function recordToldFact(
  userId: string,
  name: string,
  value: TaxFactValue,
  options: Options = {},
): Promise<void> {
  if (name !== "has_children" && !(name in KEYS_OF_TOLD)) return;
  await safely(name, async () => {
    const { client, now, today, taxYear } = await context(userId, options);
    if (name === "has_children") return syncHouseholdRecord(userId, { ...options, now });
    for (const row of factsFromTold(name, { value, day: today }, taxYear))
      await recordTaxFact(userId, row, { client, now });
  });
}

// The person took a told fact back.
export async function forgetToldFact(
  userId: string,
  name: string,
  options: Options = {},
): Promise<void> {
  if (name !== "has_children" && !(name in KEYS_OF_TOLD)) return;
  await safely(name, async () => {
    const { client, now, taxYear } = await context(userId, options);
    if (name === "has_children") return syncHouseholdRecord(userId, { ...options, now });
    for (const key of KEYS_OF_TOLD[name] ?? [])
      await forgetTaxFact(userId, { key, taxYear, origin: "answer" }, { client, now });
    // What Jane remembers from the chat, if it still says something, is the answer again.
    const remaining = (await loadToldAnswers(userId, { client }))[name];
    if (remaining)
      for (const row of factsFromTold(name, remaining, taxYear))
        await recordTaxFact(userId, row, { client, now });
  });
}

// The tax profile's household (counts and family details) as the person's answer. Read back from
// the row just written, so the record and the row cannot differ.
export async function syncHouseholdRecord(userId: string, options: Options = {}): Promise<void> {
  await safely("household", async () => {
    const { client, now, today, taxYear } = await context(userId, options);
    const row = await scopedFor(userId, client).taxProfiles.findFirst({
      select: {
        answered: true,
        childrenUnder17: true,
        otherDependants: true,
        familyChildren: true,
      },
    });
    const withDetails = parseChildren(row?.familyChildren).length > 0;
    if (!row) return;
    if (!(row.answered.includes("dependants") || withDetails)) {
      // Nothing said about the household any more: the members this profile made are removed.
      await syncProfileMembers(userId, taxYear, [], { client, now });
      await forgetMemberDetailsExcept(userId, taxYear, new Set(), { client, now });
      await retract(userId, { key: "household.dependants_stated", taxYear }, { client, now });
      return;
    }
    const counted = row.answered.includes("dependants");
    const household = householdRows(
      {
        childrenUnder17: counted ? (row.childrenUnder17 ?? 0) : 0,
        otherDependants: counted ? (row.otherDependants ?? 0) : 0,
        familyChildren: row.familyChildren,
      },
      taxYear,
      today,
    );
    await syncProfileMembers(userId, taxYear, household.members, { client, now });
    // A member is a position (child 1, child 2): what the form no longer says about one is taken
    // off, so a child's record never keeps a detail that belonged to the one before.
    const said = new Set(
      household.facts.filter((f) => f.member).map((f) => `${f.member}|${f.key}`),
    );
    await forgetMemberDetailsExcept(userId, taxYear, said, { client, now });
    for (const f of household.facts)
      await answer(userId, { ...f, sourceRef: PROFILE_ANSWER }, { client, now });
  });
}

// One field of the tax profile (the page, the chat, a "that's right" tap).
export async function recordProfileField(
  userId: string,
  field: "state" | "dependants" | "filingStatus",
  options: Options = {},
): Promise<void> {
  if (field === "filingStatus") return syncFilingRecord(userId, options);
  if (field === "dependants") return syncHouseholdRecord(userId, options);
  // Read back from the row, not carried from the caller: two saves a moment apart leave the record
  // with what the row says whichever finishes last.
  await safely("home.state", async () => {
    const { client, now, taxYear } = await context(userId, options);
    const row = await scopedFor(userId, client).taxProfiles.findFirst({
      select: { state: true, answered: true },
    });
    if (row?.state && row.answered.includes("state"))
      await answer(
        userId,
        {
          key: "home.state",
          value: row.state,
          taxYear,
          origin: "answer",
          sourceRef: PROFILE_ANSWER,
        },
        { client, now },
      );
    else await retract(userId, { key: "home.state", taxYear }, { client, now });
  });
}

// The family details form: the spouse's wages, the student's years, and the children.
export async function recordFamilyDetails(userId: string, options: Options = {}): Promise<void> {
  await syncHouseholdRecord(userId, options);
  await safely("family", async () => {
    const { client, now, taxYear } = await context(userId, options);
    const row = await scopedFor(userId, client).taxProfiles.findFirst({
      select: { spouseWagesCents: true, studentYearsBefore: true, studentHalfTime: true },
    });
    const set = async (key: TaxFactKey, value: TaxFactValue | null) => {
      if (value === null) await retract(userId, { key, taxYear }, { client, now });
      else
        await answer(
          userId,
          { key, taxYear, origin: "answer", value, sourceRef: PROFILE_ANSWER },
          { client, now },
        );
    };
    await set("spouse.earned_income", row?.spouseWagesCents ?? null);
    await set("person.postsecondary_years_before", row?.studentYearsBefore ?? null);
    await set("person.half_time", row?.studentHalfTime ?? null);
  });
}
