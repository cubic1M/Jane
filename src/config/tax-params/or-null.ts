import { NoTaxParamsError } from "./errors";

// Reads a figure that needs the year's own IRS parameters and gives null for a year Jane has none for
// (NoTaxParamsError), so a card or plan that cannot be priced is held back instead of priced with
// another year's number (Tax T32c). Anything else the read throws still throws.
export function orNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof NoTaxParamsError) return null;
    throw error;
  }
}
