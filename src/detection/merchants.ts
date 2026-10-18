import { categoryOf } from "@/categorize/taxonomy";
import { findInDirectory, type DirectoryMerchant } from "@/data-sources/merchant-directory";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { DetectionInput } from "./types";

// Gives every transaction and recurring stream from a company in the merchant directory
// that company's one name, and its category when the bank gave none. Then "NFLX DIGITAL"
// and "NETFLIX.COM" count as one merchant everywhere detection looks. Pure.
export function withDirectory(
  input: DetectionInput,
  directory: readonly DirectoryMerchant[],
): DetectionInput {
  if (directory.length === 0) return input;
  const lookup = (text: string | null) => {
    const key = text ? normalizeMerchant(text)?.key : undefined;
    return key ? findInDirectory(key, directory) : null;
  };

  return {
    ...input,
    transactions: input.transactions.map((t) => {
      const match = lookup(t.merchantName) ?? lookup(t.description);
      if (!match) return t;
      const category = t.pfcDetailed === null && match.category ? categoryOf(match.category) : null;
      return {
        ...t,
        merchantName: match.name,
        ...(category ? { pfcPrimary: category.primary, pfcDetailed: category.detailed } : {}),
      };
    }),
    recurringStreams: input.recurringStreams.map((s) => {
      const match = lookup(s.merchantName);
      return match ? { ...s, merchantName: match.name } : s;
    }),
  };
}
