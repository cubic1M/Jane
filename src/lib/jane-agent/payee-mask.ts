import { PAYMENT_APPS } from "@/config/family-loans";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "@/data-sources/merchant";
import { scopedFor } from "@/lib/db-scoped";
import { hasBusinessWord, personName } from "@/lib/person-payees";

// People's names stay out of the chat's requests to Claude (beta, 11-12). claudeFetch
// (src/lib/person-payees.ts) takes them out of a payment app's line ("ZELLE TO DANIEL SMITH"), but
// the app's own words have the app taken off first ("Daniel Smith", "From Daniel Smith": a rent
// answered yes, money_moves, what Jane remembers about rent), and then nothing marks it as a
// person. So the chat takes this person's own payment-app payees out of all it sends, as a short
// tag ("[person DS]"), and puts the name back in what the person reads, and in what a lookup is
// asked for, so "how much did I send Daniel?" still finds him.

export type PayeeMask = {
  // The request to Claude, every name as its tag.
  hide: (text: string) => string;
  // Claude's words, or a lookup it asked for, every tag as its name again.
  show: (text: string) => string;
  size: number;
};

export const NO_MASK: PayeeMask = { hide: (t) => t, show: (t) => t, size: 0 };

// At most this many payees, the most recent first: enough for anyone's friends and landlord.
const MAX_NAMES = 200;

// 2 is "b", 27 is "aa": a's place is the first tag's.
const letters = (n: number): string =>
  n <= 0 ? "" : letters(Math.floor((n - 1) / 26)) + "abcdefghijklmnopqrstuvwxyz"[(n - 1) % 26];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The payee in a payment app's line, as the app's own words write it, if it's a person's name.
export function payeeOf(description: string): string | null {
  const name = normalizeMerchant(description)?.name.replace(/^From\s+/i, "");
  if (!name || /\d/.test(name) || hasBusinessWord(name)) return null;
  // PayPal pays companies as often as people ("PAYPAL *NETFLIX"): only a name that looks like one.
  if (/paypal/i.test(description) && !personName(name)) return null;
  const words = name.split(/\s+/).filter(Boolean);
  // One short word ("Mom", "Rent") isn't worth hiding everywhere it appears.
  if (words.length === 1 && words[0]!.length < 4) return null;
  return name;
}

// The mask for these names. A name of two words or more is matched whatever its case; one word
// only as a name is written (capitalized or in capitals), so "rent" in the instructions stays.
export function maskFor(names: readonly string[]): PayeeMask {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    // Longest first, so "Daniel Smith" goes before "Daniel".
    .sort((a, b) => b.length - a.length);
  if (unique.length === 0) return NO_MASK;
  const tags = new Map<string, string>();
  const used = new Set<string>();
  const entries = unique.map((name) => {
    const initials = name
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z]/g, "")[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 3);
    let tag: string = `[person ${initials || "X"}]`;
    // Letters, not numbers, for a second DS ("DSb"): a digit in an answer is checked as a figure.
    for (let n = 2; used.has(tag); n += 1) tag = `[person ${initials || "X"}${letters(n)}]`;
    used.add(tag);
    tags.set(tag, name);
    const words = name.split(/\s+/);
    const pattern =
      words.length > 1
        ? new RegExp(`\\b${words.map(escape).join("\\s+")}\\b`, "gi")
        : new RegExp(`\\b(?:${escape(name)}|${escape(name.toUpperCase())})\\b`, "g");
    return { pattern, tag };
  });
  const back = new RegExp([...tags.keys()].map(escape).join("|"), "g");
  return {
    hide: (text) => entries.reduce((t, { pattern, tag }) => t.replace(pattern, tag), text),
    show: (text) => text.replace(back, (tag) => tags.get(tag) ?? tag),
    size: unique.length,
  };
}

// Never changed: a file's base64 data, and Claude's own thinking with its signature, which the API
// checks (written from what was already hidden, so there's nothing in it to hide).
const UNTOUCHED = new Set(["data", "thinking", "signature"]);

// Every string in a request's JSON with the names hidden.
export function hideIn<T>(value: T, mask: PayeeMask, key?: string): T {
  if (mask.size === 0) return value;
  if (typeof value === "string") {
    return (key !== undefined && UNTOUCHED.has(key) ? value : mask.hide(value)) as T;
  }
  if (Array.isArray(value)) return value.map((item) => hideIn(item, mask)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, hideIn(v, mask, k)] as const),
    ) as T;
  }
  return value;
}

// The same, the other way: a lookup's input as Claude asked for it, with the names back.
export function showIn<T>(value: T, mask: PayeeMask): T {
  if (mask.size === 0) return value;
  if (typeof value === "string") return mask.show(value) as T;
  if (Array.isArray(value)) return value.map((item) => showIn(item, mask)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, showIn(v, mask)] as const),
    ) as T;
  }
  return value;
}

// This person's payment-app payees, and the people they lent to or borrowed from.
export async function payeeMask(userId: string, client: PrismaClient): Promise<PayeeMask> {
  const db = scopedFor(userId, client);
  const [txs, loans] = await Promise.all([
    db.transactions.findMany({
      where: {
        OR: PAYMENT_APPS.map((a) => ({
          description: { contains: a, mode: "insensitive" as const },
        })),
      },
      select: { description: true },
      distinct: ["description"],
      orderBy: { date: "desc" },
      take: MAX_NAMES * 3,
    }),
    db.personalLoans.findMany({ select: { counterparty: true }, take: MAX_NAMES }),
  ]);
  const names = [
    ...txs.map((t) => payeeOf(t.description)),
    ...loans.map((l) => (hasBusinessWord(l.counterparty) ? null : l.counterparty)),
  ].filter((n): n is string => n !== null && n.length >= 4);
  return maskFor(names.slice(0, MAX_NAMES));
}
