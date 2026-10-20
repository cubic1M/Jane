import { GIFT_ANNUAL_EXCLUSION_CENTS, GIFT_MIN_CENTS } from "@/config/family";
import { IRA_LIMIT_CENTS } from "@/config/retirement";

// Investing for the family (spec step 213, demo advice). Pure.

// How much a child can still put in a Roth IRA this year: the lower of what they earned and
// the IRA limit, less what's gone in. Nothing without earned income.
export function childRothRoom(earnedCents: number, usedCents: number): number {
  return Math.max(0, Math.min(earnedCents, IRA_LIMIT_CENTS) - usedCents);
}

// A gift's amount is checked against the annual exclusion (no gift tax return up to it).
export function giftOk(amountCents: number): boolean {
  return (
    Number.isInteger(amountCents) &&
    amountCents >= GIFT_MIN_CENTS &&
    amountCents <= GIFT_ANNUAL_EXCLUSION_CENTS
  );
}

// How far along a goal is, as a whole percent capped at 100: the only progress a gift page shows.
export function percentFunded(savedCents: number, targetCents: number): number {
  if (targetCents <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((savedCents / targetCents) * 100)));
}
