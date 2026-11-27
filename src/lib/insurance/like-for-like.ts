import { COVERAGE_FIELDS, type PolicyKind } from "@/config/insurance";
import { formatCents } from "@/lib/money";
import { valueWords, type Coverage } from "./coverage";

// Like-for-like comparison (spec step 103): a quote against the person's current policy,
// field by field. Same cover and deductible, or each difference spelled out in plain words.
// Pure.

export type CoverCompare = {
  // Every limit on file and the deductible match (or the quote gives more).
  same: boolean;
  // Where the quote gives less (or differs), each in one line.
  differences: string[];
  // Where it gives more, each in one line.
  better: string[];
  // Limits the current policy doesn't have on file, so they can't be checked.
  unknown: string[];
};

type Cover = { deductibleCents: number | null; coverage: Coverage };

export function compareCover(kind: PolicyKind, current: Cover, quoted: Cover): CoverCompare {
  const differences: string[] = [];
  const better: string[] = [];
  const unknown: string[] = [];

  if (current.deductibleCents === null) {
    if (quoted.deductibleCents !== null) unknown.push("Deductible");
  } else if (quoted.deductibleCents === null) {
    // The quote does not state its deductible: it can't be called the same as yours.
    differences.push(`Deductible not stated, and yours is ${formatCents(current.deductibleCents)}`);
  } else if (quoted.deductibleCents !== current.deductibleCents) {
    const line = `Deductible ${formatCents(quoted.deductibleCents)} instead of your ${formatCents(current.deductibleCents)}`;
    if (quoted.deductibleCents > current.deductibleCents) differences.push(line);
    else better.push(line);
  }

  for (const field of COVERAGE_FIELDS[kind]) {
    const have = current.coverage[field.key];
    const offered = quoted.coverage[field.key];
    if (have === undefined) {
      if (offered !== undefined) unknown.push(field.label);
      continue;
    }
    if (offered === undefined || offered === false) {
      if (have !== false) differences.push(`${field.label}: not included, and you have it now`);
      continue;
    }
    if (field.type === "yesno") {
      if (have === false && offered === true)
        better.push(`${field.label}: included, and you don't have it now`);
      continue;
    }
    if (offered === have) continue;
    const line = `${field.label}: ${valueWords(field, offered)} instead of your ${valueWords(field, have)}`;
    // A longer term or more cover is more; a lower limit is less.
    if ((offered as number) < (have as number)) differences.push(line);
    else better.push(line);
  }
  return { same: differences.length === 0, differences, better, unknown };
}

// The comparison for a kept quote against the policy as it is NOW: a policy edited after the
// quote was stored (a new deductible, a new limit) must not leave "same cover" on the card.
export function recheckCover<
  Q extends {
    sameCover: boolean;
    differences: string[];
    deductibleCents: number | null;
    coverage: Coverage;
  },
>(kind: PolicyKind, current: Cover, quotes: readonly Q[]): Q[] {
  return quotes.map((q) => {
    const cover = compareCover(kind, current, q);
    // Shown as "same" only when nothing differs either way: a quote with a lower deductible than
    // the edited policy is not the same cover, so the line is spelled out.
    const differences = [...cover.differences, ...cover.better];
    return { ...q, sameCover: differences.length === 0, differences };
  });
}
