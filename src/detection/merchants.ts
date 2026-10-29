import { categoryOf } from "@/categorize/taxonomy";
import { findInDirectory, type DirectoryMerchant } from "@/data-sources/merchant-directory";
import { normalizeMerchant, withoutCity } from "@/data-sources/merchant";
import type { DetectionInput } from "./types";

type Named = {
  merchantName: string | null;
  description: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
};

function directoryLookup(directory: readonly DirectoryMerchant[]) {
  return (text: string | null) => {
    const key = text ? normalizeMerchant(text)?.key : undefined;
    if (!key) return null;
    // The city a card wrote after the company, when the company is one the directory knows.
    return (
      findInDirectory(key, directory) ??
      withoutCity(text!)
        .map((shorter) => findInDirectory(shorter, directory))
        .find((match) => match !== null) ??
      null
    );
  };
}

// Each transaction from a company in the merchant directory under that company's one name, and
// its category when the bank gave none. Detection and the chat's search both name them this way,
// so a card's "Apple Store" is what the search finds (card-chat mismatch). Pure.
export function namedByDirectory<T extends Named>(
  transactions: readonly T[],
  directory: readonly DirectoryMerchant[],
): T[] {
  if (directory.length === 0) return [...transactions];
  const lookup = directoryLookup(directory);
  return transactions.map((t) => {
    const match = lookup(t.merchantName) ?? lookup(t.description);
    if (!match) return t;
    const category = t.pfcDetailed === null && match.category ? categoryOf(match.category) : null;
    return {
      ...t,
      merchantName: match.name,
      ...(category ? { pfcPrimary: category.primary, pfcDetailed: category.detailed } : {}),
    };
  });
}

// Gives every transaction and recurring stream from a company in the merchant directory
// that company's one name, and its category when the bank gave none. Then "NFLX DIGITAL"
// and "NETFLIX.COM" count as one merchant everywhere detection looks. Pure.
export function withDirectory(
  input: DetectionInput,
  directory: readonly DirectoryMerchant[],
): DetectionInput {
  if (directory.length === 0) return input;
  const lookup = directoryLookup(directory);
  return {
    ...input,
    transactions: namedByDirectory(input.transactions, directory),
    recurringStreams: input.recurringStreams.map((s) => {
      const match = lookup(s.merchantName);
      return match ? { ...s, merchantName: match.name } : s;
    }),
  };
}
