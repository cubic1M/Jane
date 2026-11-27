import { NoTaxParamsError } from "./errors";
import type { Cited } from "./types";

// A figure group its source has not published yet (Tax T32b), for example the IRS business mileage
// rate, announced in a December notice. The group is in the year's file with where it will come
// from and when, but it holds NO value: reading `.value` throws NoTaxParamsError carrying the year
// and the group, so no caller can reach a number, a zero, a copy of another year's or a guess.
// The year stays supported: every other group prices normally. The getter is not enumerable, so
// freezing, the fingerprint and JSON never touch it; a walk over a year's groups must check
// `isAwaited` first (the params tests do).
export function awaited<T>(
  year: number,
  key: string,
  meta: { source: string; where: string; checkedOn: string; verify: string },
): Cited<T> {
  const group = {
    source: meta.source,
    where: meta.where,
    checkedOn: meta.checkedOn,
    status: "awaited" as const,
    verify: meta.verify,
  };
  Object.defineProperty(group, "value", {
    enumerable: false,
    get(): never {
      throw new NoTaxParamsError(year, "US", key);
    },
  });
  return group as unknown as Cited<T>;
}

export const isAwaited = (group: { status: string }): boolean => group.status === "awaited";
