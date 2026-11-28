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
import { personTransaction, scopedFor, type PersonTx } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";

// Writing a tax fact (tax roadmap 1.3, step T9). A fact is never changed in place: a new value from
// the same origin supersedes that origin's current row (superseded_at set) and adds a new one, so
// what the person said before stays in the table, unless they take it back (forgetTaxFacts removes
// it for good). An answer older than the current row's moment changes nothing, so two saves that
// land in the wrong order leave the newer one. The partial unique index
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

// "stale": a newer answer for the same fact was recorded first, so this older one changed nothing.
export type RecordOutcome = "recorded" | "unchanged" | "stale";

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

// Thrown inside a write when the row it meant to supersede changed under it: look again.
class Moved extends Error {}

type Tx = PersonTx;

const sameAnswer = (
  current: { value: unknown; status: string },
  data: { value?: unknown; status?: string },
) => JSON.stringify(current.value) === JSON.stringify(data.value) && current.status === data.status;

// One row into a transaction. The same answer is left as it is. A different one from the same origin
// supersedes that origin's current row (kept as history). An answer older than the current row's own
// moment writes nothing: an older save that arrives last must not undo a newer one. `at` is the
// moment the answer was given. The partial unique index tax_facts_current_key settles two writers
// that get here at once: the loser's insert fails and the caller looks again.
export async function writeFactRow(
  tx: Tx,
  userId: string,
  data: Prisma.TaxFactUncheckedCreateInput,
  at: Date,
  // A repeat of the current answer made later moves the row's moment forward, so an older save that
  // arrives after it can no longer replace it. A bulk copy leaves the moments alone.
  { advance = true }: { advance?: boolean } = {},
): Promise<RecordOutcome> {
  const current = await tx.taxFact.findFirst({
    where: {
      userId,
      taxYear: data.taxYear,
      memberKey: data.memberKey,
      key: data.key,
      origin: data.origin,
      supersededAt: null,
    },
    select: { id: true, value: true, status: true, recordedAt: true },
  });
  if (current && sameAnswer(current, data)) {
    if (advance && current.recordedAt.getTime() < at.getTime()) {
      const { count } = await tx.taxFact.updateMany({
        where: { id: current.id, userId, supersededAt: null, recordedAt: { lt: at } },
        data: { recordedAt: at },
      });
      // The row moved under us (another save superseded it, or a repeat advanced it): look again.
      if (count === 0) throw new Moved();
    }
    return "unchanged";
  }
  if (current) {
    if (current.recordedAt.getTime() > at.getTime()) return "stale";
    const { count } = await tx.taxFact.updateMany({
      where: { id: current.id, userId, supersededAt: null, recordedAt: { lte: at } },
      data: { supersededAt: at },
    });
    if (count === 0) throw new Moved();
  }
  await tx.taxFact.create({ data: { ...data, recordedAt: at } });
  return "recorded";
}

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
  const sensitive = taxFactSpec(input.key).sensitive;
  let audited = false;
  const audit = () =>
    logAudit(
      { type: "user", id: userId },
      "tax_fact_recorded",
      { type: "user", id: userId },
      // Which fact and where from, never what it says.
      { key: input.key, origin: input.origin },
    );
  if (sensitive) {
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
    if (!current || !sameAnswer(current, data)) {
      await audit();
      audited = true;
    }
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await personTransaction(
        userId,
        (tx) => writeFactRow(tx, userId, data, now),
        client,
      );
      // The check above saw the same answer, but another save changed it before this write did:
      // the change is audited here, so no sensitive change goes without its entry.
      if (outcome === "recorded" && sensitive && !audited) await audit();
      return outcome;
    } catch (error) {
      // Another write for the same fact got in between: look again.
      if (!(isUniqueClash(error) || error instanceof Moved) || attempt >= WRITE_TRIES) throw error;
    }
  }
}

// The origins that are the person's own word: an answer they gave, and the copy made of what an
// older store held (which may disagree with it). What a document or a connector said is read again
// from its source, so a forget leaves it alone.
export const OWN_WORD_ORIGINS: readonly FactOrigin[] = ["answer", "legacy"];

export type ForgetScope = {
  // Each of these facts, in every tax year.
  keys: readonly TaxFactKey[];
  // "self" unless given; "all" for every member of the household.
  member?: string;
};

// The person took an answer back, or erased it: every row of those facts that came from their own
// word goes for good, the current ones and the superseded ones, in every year, so nothing of what
// they said is kept as history. The fact then reads as what the other sources say, or unknown.
// Returns how many rows went.
export async function forgetTaxFacts(
  userId: string,
  { keys, member = "self" }: ForgetScope,
  { client = defaultClient }: Options = {},
): Promise<number> {
  const { count } = await personTransaction(
    userId,
    (tx) =>
      tx.taxFact.deleteMany({
        where: {
          userId,
          key: { in: [...keys] },
          origin: { in: [...OWN_WORD_ORIGINS] },
          ...(member === "all" ? {} : { memberKey: member }),
        },
      }),
    client,
  );
  return count;
}
