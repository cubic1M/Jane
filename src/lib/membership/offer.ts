import { DEFAULT_PRICE_CENTS, OFFER_SNOOZE_DAYS } from "@/config/membership";
import { DAY_MS } from "@/lib/dates";

// Who sees the membership offer. It appears once a person's first action is done, never
// blocks anything, and after "not now" stays hidden for OFFER_SNOOZE_DAYS.

export type OfferState = {
  hasFinishedAction: boolean;
  intents: { kind: "reserve" | "paid" }[];
  dismissedAt: Date | null;
  shownAt: Date | null;
};

export type Offer =
  { show: false; member: "reserved" | "paid" | null } | { show: true; countAsShown: boolean };

const withinSnooze = (at: Date | null, now: Date) =>
  at !== null && now.getTime() - at.getTime() < OFFER_SNOOZE_DAYS * DAY_MS;

export function membershipOffer(state: OfferState, now: Date): Offer {
  if (state.intents.some((i) => i.kind === "paid")) return { show: false, member: "paid" };
  if (state.intents.some((i) => i.kind === "reserve")) return { show: false, member: "reserved" };
  if (!state.hasFinishedAction || withinSnooze(state.dismissedAt, now)) {
    return { show: false, member: null };
  }
  return { show: true, countAsShown: !withinSnooze(state.shownAt, now) };
}

// The founding-member price in cents, from MEMBERSHIP_TEST_PRICE.
export function membershipPriceCents(): number {
  const parsed = Number.parseInt(process.env.MEMBERSHIP_TEST_PRICE ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PRICE_CENTS;
}

// The paid option appears only once Stripe is set up; Reserve always works.
export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
