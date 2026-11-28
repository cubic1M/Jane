import { isFilingStatus } from "@/config/tax";
import type { ScopedDb } from "@/lib/db-scoped";

// Taking back what a person told Jane. Some told facts (jane_preferences "profile:<key>", and the
// memory fact beside it) are also copied into another table when they are said, so every reader of
// that table agrees: how they file and having children into the tax profile (src/lib/profile.ts
// correctFact), their age into the investor profile, own or rent into the insurance profile. When
// the person takes the told answer back (Settings "Forget", "Delete all memory", a deleted
// preference, a correction cleared) the copy goes with it, in the same transaction, so no reader is
// left holding what they asked Jane to forget.
//
// The rule: a copy is taken back only while it still says what the told answer said. A different
// answer on the other side (say, a later one on the tax profile form) is theirs and stays; the form
// also saves the told answer, so for filing status the two are one answer and forgetting it clears
// both. After a take-back the person is "not said": the guess applies and the question can be asked
// again.

export type ScopedTx = Parameters<Parameters<ScopedDb["transaction"]>[0]>[0];

// A told answer being taken back: its fact key ("filing_status") and what it said.
export type TakenBack = { key: string; value: unknown };

export const TOLD_PREFIX = "profile:";

// The fact a preference key stands for, or null when it is not a told profile fact.
export const toldKeyOf = (prefKey: string): string | null =>
  prefKey.startsWith(TOLD_PREFIX) ? prefKey.slice(TOLD_PREFIX.length) : null;

// The answer a preference or fact value holds: { value } on both, the bare value on neither.
export const toldValueOf = (stored: unknown): unknown =>
  stored !== null && typeof stored === "object" && "value" in stored
    ? (stored as { value: unknown }).value
    : stored;

// A write is made against the row that was read, and tried again when another save changed it in
// between (two saves at once must not drop each other's marker). Out of tries it throws, and the
// transaction around it rolls back: nothing is forgotten by half.
const WRITE_TRIES = 4;

async function retry(step: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < WRITE_TRIES; attempt += 1) if (await step()) return;
  throw new Error(`The ${what} kept changing while an answer was taken back`);
}

async function takeBackFiling(tx: ScopedTx, was: string): Promise<void> {
  await retry(async () => {
    const row = await tx.taxProfiles.findFirst({ select: { filingStatus: true, answered: true } });
    if (!row || row.filingStatus !== was || !row.answered.includes("filingStatus")) return true;
    const cleared = await tx.taxProfiles.updateMany({
      where: { filingStatus: was, answered: { equals: row.answered } },
      data: { filingStatus: null, answered: row.answered.filter((f) => f !== "filingStatus") },
    });
    return cleared.count > 0;
  }, "tax profile");
}

// The mirror wrote 1 (yes, at least one child) or 0 (no) and marked "dependants" answered; a count
// the person gave on the tax profile form (two children, or any other dependants) is not the mirror's
// and stays: a form answer with other dependants is theirs whole, and can't be told from the mirror's.
async function takeBackChildren(tx: ScopedTx, was: boolean): Promise<void> {
  await retry(async () => {
    const row = await tx.taxProfiles.findFirst({
      select: { childrenUnder17: true, otherDependants: true, answered: true },
    });
    if (!row || !row.answered.includes("dependants")) return true;
    const mirrored = row.childrenUnder17 === (was ? 1 : 0) && !row.otherDependants;
    if (!mirrored) return true;
    const cleared = await tx.taxProfiles.updateMany({
      where: {
        childrenUnder17: row.childrenUnder17,
        otherDependants: row.otherDependants,
        answered: { equals: row.answered },
      },
      data: {
        childrenUnder17: null,
        otherDependants: null,
        answered: row.answered.filter((f) => f !== "dependants"),
      },
    });
    return cleared.count > 0;
  }, "tax profile");
}

// Takes the copies of these told answers back. Call it inside the transaction that deletes them.
export async function takeBackMirrors(tx: ScopedTx, told: readonly TakenBack[]): Promise<void> {
  for (const { key, value } of told) {
    if (key === "filing_status" && isFilingStatus(value)) await takeBackFiling(tx, value);
    else if (key === "has_children" && typeof value === "boolean")
      await takeBackChildren(tx, value);
    else if (key === "age" && typeof value === "number")
      await tx.investorProfiles.updateMany({
        where: { age: value },
        // The questionnaire is no longer complete without it.
        data: { age: null, ageOn: null, answeredAt: null },
      });
    else if (key === "housing" && (value === "own" || value === "rent"))
      await tx.insuranceProfiles.updateMany({ where: { housing: value }, data: { housing: null } });
  }
}
