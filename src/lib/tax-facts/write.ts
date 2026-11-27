import {
  NOT_YEAR_SCOPED,
  TAX_FACT_CONFIDENCE,
  isFactOrigin,
  isTaxFactKey,
  taxFactSpec,
  type FactOrigin,
  type StoredFactStatus,
  type TaxFactKey,
  type TaxFactSpec,
} from "@/config/tax-facts";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { personTransaction, scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";

// Writing a tax fact (tax roadmap 1.3, step T9). A fact is never changed in place: a new value from
// the same origin supersedes that origin's current row (superseded_at set) and adds a new one, so
// what the person said before stays in the table. The partial unique index
// tax_facts_current_key lets only one row per fact, year, member and origin be current.

export type TaxFactValue = string | number | boolean;

export type TaxFactInput = {
  key: TaxFactKey;
  value: TaxFactValue;
  // The tax year it is true for. Ignored (stored as 0) for a fact that is not year-scoped.
  taxYear: number;
  // "self", "spouse" or a tax_household_members.member_key.
  member?: string;
  origin: FactOrigin;
  status?: StoredFactStatus;
  // "question:<fact>", "tax_document:<id>", "suggestion:<key>", "plaid:liabilities".
  sourceRef?: string | null;
  confidence?: number;
  // The person's own day it was true; their today by default.
  asOf?: string;
};

export type RecordOutcome = "recorded" | "unchanged";

export class TaxFactError extends Error {}

type Options = { client?: PrismaClient; now?: Date };

const WRITE_TRIES = 3;

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

// A value must fit the fact's kind, whoever writes it.
export function checkTaxFactValue(spec: TaxFactSpec, value: unknown): TaxFactValue {
  const fits =
    spec.type === "boolean"
      ? typeof value === "boolean"
      : spec.type === "number" || spec.type === "cents"
        ? typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        : spec.type === "choice"
          ? typeof value === "string" && (spec.choices ?? []).includes(value)
          : typeof value === "string" && value.length > 0 && value.length <= 120;
  if (!fits) throw new TaxFactError(`That is not a value for ${spec.key}.`);
  return value as TaxFactValue;
}

// Shared by the write and by read-repair (which inserts many at once).
export function storedFactData(
  userId: string,
  input: TaxFactInput,
  day: string,
): Prisma.TaxFactUncheckedCreateInput {
  if (!isTaxFactKey(input.key)) throw new TaxFactError("Not a tax fact.");
  if (!isFactOrigin(input.origin)) throw new TaxFactError("Not a place a fact can come from.");
  const spec = taxFactSpec(input.key);
  const value = checkTaxFactValue(spec, input.value);
  const status = input.status ?? "known";
  const confidence = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        input.confidence ??
          (status === "inferred"
            ? TAX_FACT_CONFIDENCE.inferred
            : TAX_FACT_CONFIDENCE[input.origin]),
      ),
    ),
  );
  return {
    userId,
    taxYear: spec.yearScoped ? input.taxYear : NOT_YEAR_SCOPED,
    memberKey: input.member ?? "self",
    key: input.key,
    value: { v: value },
    status,
    origin: input.origin,
    sourceRef: input.sourceRef ?? null,
    confidence,
    asOf: dayDate(input.asOf ?? day),
  };
}

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// Records one fact. The same value from the same origin is left as it is (its day and sureness
// stay), so asking twice changes nothing. A sensitive fact is written to the audit log by its key
// and origin, never its value.
export async function recordTaxFact(
  userId: string,
  input: TaxFactInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RecordOutcome> {
  const day = input.asOf ?? (await todayOf(userId, { client, now }));
  const data = storedFactData(userId, input, day);
  // A sensitive fact is audited before it is written, and only when it would change: an entry for a
  // write that then fails is a harmless extra, a write with no entry is not.
  if (taxFactSpec(input.key).sensitive) {
    const current = await scopedFor(userId, client).taxFacts.findFirst({
      where: {
        taxYear: data.taxYear,
        memberKey: data.memberKey,
        key: data.key,
        origin: data.origin,
        supersededAt: null,
      },
      select: { value: true, status: true },
    });
    if (
      !current ||
      JSON.stringify(current.value) !== JSON.stringify(data.value) ||
      current.status !== data.status
    ) {
      await logAudit(
        { type: "user", id: userId },
        "tax_fact_recorded",
        { type: "user", id: userId },
        // Which fact and where from, never what it says.
        { key: input.key, origin: input.origin },
      );
    }
  }
  let outcome: RecordOutcome = "unchanged";
  for (let attempt = 1; ; attempt += 1) {
    try {
      outcome = await personTransaction(
        userId,
        async (tx) => {
          const current = await tx.taxFact.findFirst({
            where: {
              userId,
              taxYear: data.taxYear,
              memberKey: data.memberKey,
              key: data.key,
              origin: data.origin,
              supersededAt: null,
            },
            select: { id: true, value: true, status: true },
          });
          if (
            current &&
            JSON.stringify(current.value) === JSON.stringify(data.value) &&
            current.status === data.status
          ) {
            return "unchanged" as const;
          }
          if (current) {
            await tx.taxFact.updateMany({
              where: { id: current.id, userId, supersededAt: null },
              data: { supersededAt: now },
            });
          }
          await tx.taxFact.create({ data });
          return "recorded" as const;
        },
        client,
      );
      break;
    } catch (error) {
      // Another write for the same fact got in between: look again.
      if (!isUniqueClash(error) || attempt >= WRITE_TRIES) throw error;
    }
  }
  return outcome;
}

// The person took an answer back: that origin's current row is superseded and nothing replaces it,
// so the fact reads as what the other origins say, or unknown. The row stays as history.
export async function forgetTaxFact(
  userId: string,
  input: { key: TaxFactKey; taxYear: number; member?: string; origin: FactOrigin },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const spec = taxFactSpec(input.key);
  const { count } = await personTransaction(
    userId,
    (tx) =>
      tx.taxFact.updateMany({
        where: {
          userId,
          taxYear: spec.yearScoped ? input.taxYear : NOT_YEAR_SCOPED,
          memberKey: input.member ?? "self",
          key: input.key,
          origin: input.origin,
          supersededAt: null,
        },
        data: { supersededAt: now },
      }),
    client,
  );
  return count;
}

// The details a household sync owns on the members it makes (`child:legacy-N`).
const MEMBER_DETAIL_KEYS = [
  "member.birth_date",
  "member.months_lived_with_you",
  "member.ssn_valid_for_work",
];

// Takes off the details of the profile's members that a sync no longer says: every current one of
// those keys (from the person's answer or the copy of the older store) not in `keep`, which holds
// `member|key`. What another source says about a member is left.
export async function forgetMemberDetailsExcept(
  userId: string,
  taxYear: number,
  keep: ReadonlySet<string>,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await personTransaction(
    userId,
    async (tx) => {
      const rows = await tx.taxFact.findMany({
        where: {
          userId,
          taxYear: { in: [taxYear, NOT_YEAR_SCOPED] },
          supersededAt: null,
          key: { in: MEMBER_DETAIL_KEYS },
          origin: { in: ["answer", "legacy"] },
          memberKey: { startsWith: "child:legacy-" },
        },
        select: { id: true, memberKey: true, key: true },
      });
      const drop = rows.filter((r) => !keep.has(`${r.memberKey}|${r.key}`)).map((r) => r.id);
      if (drop.length > 0)
        await tx.taxFact.updateMany({
          where: { userId, id: { in: drop }, supersededAt: null },
          data: { supersededAt: now },
        });
    },
    client,
  );
}

export type MemberInput = { memberKey: string; label: string; relationship: string };

// The household's members for a year, from the tax profile's own counts: those given are present
// (added when missing, brought back when removed), and the ones the profile made earlier that are
// no longer counted are marked removed, never deleted. Members the person added any other way
// (their key is not `…:legacy-N`) are not touched.
export async function syncProfileMembers(
  userId: string,
  taxYear: number,
  members: readonly MemberInput[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await personTransaction(
    userId,
    async (tx) => {
      const keep = members.map((m) => m.memberKey);
      await tx.taxHouseholdMember.createMany({
        data: members.map((m) => ({ ...m, userId, taxYear })),
        skipDuplicates: true,
      });
      await tx.taxHouseholdMember.updateMany({
        where: { userId, taxYear, memberKey: { in: keep }, removedAt: { not: null } },
        data: { removedAt: null },
      });
      await tx.taxHouseholdMember.updateMany({
        where: {
          userId,
          taxYear,
          removedAt: null,
          memberKey: { notIn: keep },
          OR: [
            { memberKey: { startsWith: "child:legacy-" } },
            { memberKey: { startsWith: "relative:legacy-" } },
          ],
        },
        data: { removedAt: now },
      });
    },
    client,
  );
}
