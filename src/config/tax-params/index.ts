import versions from "./params-version.json";
import type { FederalParams } from "./types";
import { US_2026 } from "./us-2026";

export type { Bracket, Cited, FederalParams, ParamStatus } from "./types";
export { ALLOWED_SOURCE_HOSTS } from "./types";

// The tax years Jane has complete, cited figures for. 2026 alone after T1; 2025 is added by T3.
export const SUPPORTED_TAX_YEARS = [2026] as const;

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

const FEDERAL: Readonly<Record<number, FederalParams>> = { 2026: US_2026 };

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
