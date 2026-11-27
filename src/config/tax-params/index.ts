import versions from "./params-version.json";
import type { FederalParams } from "./types";
import { US_2025 } from "./us-2025";
import { US_2026 } from "./us-2026";

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

// A fingerprint of each year's figures (sha256 of the canonical JSON, kept in params-version.json).
// Changing a figure changes it, so a figure moves only with a deliberate update in the same PR.
export const PARAMS_VERSION: Readonly<Record<string, string>> = versions;

// Every group of a year whose figures are not all confirmed at the source, with what is missing.
// The completeness test pins this list, so a new note, or a cleared one, is a visible change.
export function verifyNotes(year: number): { key: string; status: string; note: string }[] {
  const params = federalParams(year);
  return Object.entries(params).flatMap(([key, group]) =>
    typeof group === "object" && group !== null && "status" in group
      ? group.status !== "verified" || group.verify
        ? [{ key, status: group.status as string, note: group.verify ?? "" }]
        : []
      : [],
  );
}
