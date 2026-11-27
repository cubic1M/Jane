import versions from "./params-version.json";
import type { FederalParams, ParamStatus } from "./types";
import { US_2025 } from "./us-2025";
import { US_2026 } from "./us-2026";
import { US_2027 } from "./us-2027";

export type { Bracket, Cited, FederalParams, ParamStatus } from "./types";
export { ALLOWED_SOURCE_HOSTS } from "./types";

// The tax years Jane has complete, cited figures for: 2026 (Tax T1) and 2025 (Tax T3).
export const SUPPORTED_TAX_YEARS = [2025, 2026] as const;

// A year with no figures is refused, never priced with another year's law.
export class NoTaxParamsError extends Error {
  constructor(
    readonly year: number,
    readonly jurisdiction: "US" | "CA",
  ) {
    super(`No ${jurisdiction} tax figures for ${year}`);
    this.name = "NoTaxParamsError";
  }
}

// A caller can't change a shared table: every level is frozen.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const FEDERAL: Readonly<Record<number, FederalParams>> = {
  2025: deepFreeze(US_2025),
  2026: deepFreeze(US_2026),
};

export function federalParams(year: number): FederalParams {
  const params = FEDERAL[year];
  if (!params) throw new NoTaxParamsError(year, "US");
  return params;
}

// A year whose file exists but whose figures are not all published (Tax T32): kept so the nightly
// check knows what is awaited. Never priced: federalParams refuses it, so nothing can use a
// figure that is not confirmed. It moves to FEDERAL and SUPPORTED_TAX_YEARS when complete.
const DRAFT: Readonly<Record<number, FederalParams>> = {
  2027: deepFreeze(US_2027),
};

export const DRAFT_TAX_YEARS: readonly number[] = Object.keys(DRAFT).map(Number);

export function draftParams(year: number): FederalParams {
  const params = DRAFT[year];
  if (!params) throw new NoTaxParamsError(year, "US");
  return params;
}

export type PendingGroup = {
  year: number;
  key: string;
  status: ParamStatus;
  checkedOn: string;
  note: string;
};

// Every group not yet final: in a draft year, any that is not verified; in a supported year, any
// still read from an IRS draft. The nightly check ages them (TAX_DRAFT_MAX_DAYS).
export function pendingGroups(): PendingGroup[] {
  const pending = (year: number, params: FederalParams, only: (s: ParamStatus) => boolean) =>
    Object.entries(params).flatMap(([key, group]) =>
      typeof group === "object" && group !== null && "status" in group && only(group.status)
        ? [
            {
              year,
              key,
              status: group.status,
              checkedOn: group.checkedOn,
              note: group.verify ?? "",
            },
          ]
        : [],
    );
  return [
    ...SUPPORTED_TAX_YEARS.flatMap((y) => pending(y, federalParams(y), (s) => s === "draft")),
    ...DRAFT_TAX_YEARS.flatMap((y) => pending(y, draftParams(y), (s) => s !== "verified")),
  ];
}

// The year itself when Jane has its figures, else NoTaxParamsError (the "no_params" state). For a
// figure shown as the tax of a specific year (a card's saving, a withholding check): never another
// year's law. The detector runner holds such a card back on this error.
export function ownLawYear(year: number): number {
  federalParams(year);
  return year;
}

// The year whose law a FORWARD PROJECTION uses for `year`: the newest year with figures at or before it,
// so "your income as it stands" is priced with today's law held fixed when the year's own figures are
// not out yet, and the figure says so where it shows ("2026 tax law held fixed"). It is never for a
// figure shown as a specific year's own (an estimate, a refund, a saving for that year): those call
// federalParams(year) or ownLawYear(year) and throw NoTaxParamsError. A year before the first
// supported one has no law to hold fixed and throws.
export function lawYearFor(year: number): number {
  const known = Object.keys(FEDERAL)
    .map(Number)
    .filter((y) => y <= year);
  if (known.length === 0) throw new NoTaxParamsError(year, "US");
  return Math.max(...known);
}

// A fingerprint of each year's figures (sha256 of the canonical JSON, kept in params-version.json).
// Changing a figure changes it, so a figure moves only with a deliberate update in the same PR.
export const PARAMS_VERSION: Readonly<Record<string, string>> = versions;

// Every group of a year whose figures are not all confirmed at the source, with what is missing.
// The completeness test pins this list, so a new note, or a cleared one, is a visible change.
export function verifyNotes(year: number): { key: string; status: string; note: string }[] {
  const params = FEDERAL[year] ?? draftParams(year);
  return Object.entries(params).flatMap(([key, group]) =>
    typeof group === "object" && group !== null && "status" in group
      ? group.status !== "verified" || group.verify
        ? [{ key, status: group.status as string, note: group.verify ?? "" }]
        : []
      : [],
  );
}

// The age (at the year's end) from which the additional standard deduction applies (26 USC 63(f)(1)(A); statute, not indexed).
export const ADDITIONAL_STANDARD_AGE = 65;
