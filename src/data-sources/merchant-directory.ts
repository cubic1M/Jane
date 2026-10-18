import { normalizeMerchant } from "./merchant";

// Matches a normalized merchant key to a company in the merchant directory, so "NFLX
// DIGITAL" and "NETFLIX.COM" are the same company. Pure: the directory rows come in.

export type DirectoryMerchant = {
  key: string;
  name: string;
  aliases: readonly string[];
  category: string | null;
};

// An exact match, or for phrases of two words or more, whole words at the start:
// "spotify usa stockholm" matches "spotify usa". One word must match exactly, so
// "apple store" isn't Apple's subscriptions and "maxwell" isn't Max.
function matches(key: string, phrase: string): boolean {
  if (key === phrase) return true;
  return phrase.includes(" ") && key.startsWith(`${phrase} `);
}

export function findInDirectory(
  merchantKey: string,
  directory: readonly DirectoryMerchant[],
): DirectoryMerchant | null {
  let best: { merchant: DirectoryMerchant; length: number } | null = null;
  for (const merchant of directory) {
    for (const phrase of [merchant.key, ...merchant.aliases]) {
      // The longest matching phrase wins, so "youtube premium" beats a shorter alias.
      if (matches(merchantKey, phrase) && (!best || phrase.length > best.length)) {
        best = { merchant, length: phrase.length };
      }
    }
  }
  return best?.merchant ?? null;
}

// The directory's name and category for a bank description, or null if it isn't listed.
export function directoryMatch(
  description: string,
  directory: readonly DirectoryMerchant[],
): DirectoryMerchant | null {
  const merchant = normalizeMerchant(description);
  return merchant ? findInDirectory(merchant.key, directory) : null;
}

// Aliases and keys are stored the way normalizeMerchant would write them.
export function normalizeAlias(text: string): string | null {
  return normalizeMerchant(text)?.key ?? null;
}
