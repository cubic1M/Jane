import { SHARE_MIN_FOUND_CENTS, SHARE_ROUNDING } from "@/config/share";
import { formatWholeDollars } from "@/lib/money";

// The shareable result card: after the report's findings or checkup, a beta user can share
// "Jane found me $X/yr" (rounded) or, with little to save, "Jane checked N things. I'm in good
// shape." The card is one of those two lines and nothing else: by its type it has no room for
// a merchant, an account, a balance or a name. Pure, so the browser can use it too; the
// person's card is worked out in src/lib/share-current.ts, the link and its counts in
// src/lib/share-invites.ts.

export type ShareCard = { kind: "found"; dollars: number } | { kind: "checked"; checks: number };

// Rounded down to the config's step, so the card never shows an exact figure.
export function roundFoundCents(cents: number): number {
  const { stepCents } = SHARE_ROUNDING.find((r) => cents < r.underCents)!;
  return Math.floor(cents / stepCents) * stepCents;
}

// What the card says for this much found a year and this many checks run. Null when there is
// nothing to share yet (no findings worth showing and no checkup).
export function cardFor({
  foundCents,
  checks,
}: {
  foundCents: number;
  checks: number;
}): ShareCard | null {
  if (foundCents >= SHARE_MIN_FOUND_CENTS) {
    return { kind: "found", dollars: roundFoundCents(foundCents) / 100 };
  }
  return checks > 0 ? { kind: "checked", checks } : null;
}

export function cardHeadline(card: ShareCard): string {
  const { small, big } = cardLines(card);
  return `${small} ${big}`;
}

// The card stored on a share code, or null when it's missing or not one we write.
export function cardFromRow(kind: string | null, value: number | null): ShareCard | null {
  if (value === null || !Number.isSafeInteger(value) || value <= 0) return null;
  if (kind === "found") return { kind, dollars: value };
  if (kind === "checked") return { kind, checks: value };
  return null;
}

export const cardValue = (card: ShareCard) => (card.kind === "found" ? card.dollars : card.checks);

// The card's two lines, small then big: "Jane found me" / "$1,200/yr".
export function cardLines(card: ShareCard): { small: string; big: string } {
  return card.kind === "found"
    ? { small: "Jane found me", big: `${formatWholeDollars(card.dollars * 100)}/yr` }
    : {
        small: `Jane checked ${card.checks} ${card.checks === 1 ? "thing" : "things"}.`,
        big: "I'm in good shape.",
      };
}

// The card's image (src/app/api/share/card/route.tsx). It takes only the kind and a number, so
// nothing else about anyone can ever be drawn on it.
export const cardImagePath = (card: ShareCard) =>
  `/api/share/card?kind=${card.kind}&value=${cardValue(card)}`;

// The image route's query, or null for anything but a kind and a whole number.
export function cardFromQuery(kind: string | null, value: string | null): ShareCard | null {
  if (!value || !/^\d{1,7}$/.test(value)) return null;
  return cardFromRow(kind, Number(value));
}
