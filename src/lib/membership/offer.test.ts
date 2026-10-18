import { afterEach, describe, expect, it, vi } from "vitest";
import { membershipOffer, membershipPriceCents, stripeEnabled, type OfferState } from "./offer";

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const state = (overrides: Partial<OfferState> = {}): OfferState => ({
  hasFinishedAction: true,
  intents: [],
  dismissedAt: null,
  shownAt: null,
  ...overrides,
});

describe("membershipOffer", () => {
  it("starts after the first finished action", () => {
    expect(membershipOffer(state({ hasFinishedAction: false }), NOW)).toEqual({
      show: false,
      member: null,
    });
    expect(membershipOffer(state(), NOW)).toEqual({ show: true, countAsShown: true });
  });

  it("stays hidden for 14 days after 'not now'", () => {
    expect(membershipOffer(state({ dismissedAt: daysAgo(13) }), NOW).show).toBe(false);
    expect(membershipOffer(state({ dismissedAt: daysAgo(15) }), NOW).show).toBe(true);
  });

  it("counts as shown at most once per 14 days", () => {
    expect(membershipOffer(state({ shownAt: daysAgo(3) }), NOW)).toEqual({
      show: true,
      countAsShown: false,
    });
    expect(membershipOffer(state({ shownAt: daysAgo(20) }), NOW)).toEqual({
      show: true,
      countAsShown: true,
    });
  });

  it("is replaced by a thank-you once someone reserves or pays", () => {
    expect(membershipOffer(state({ intents: [{ kind: "reserve" }] }), NOW)).toEqual({
      show: false,
      member: "reserved",
    });
    expect(
      membershipOffer(state({ intents: [{ kind: "reserve" }, { kind: "paid" }] }), NOW),
    ).toEqual({
      show: false,
      member: "paid",
    });
  });
});

describe("price and Stripe settings", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the price from MEMBERSHIP_TEST_PRICE, defaulting to $49", () => {
    vi.stubEnv("MEMBERSHIP_TEST_PRICE", "2900");
    expect(membershipPriceCents()).toBe(2900);
    vi.stubEnv("MEMBERSHIP_TEST_PRICE", "");
    expect(membershipPriceCents()).toBe(4900);
    vi.stubEnv("MEMBERSHIP_TEST_PRICE", "abc");
    expect(membershipPriceCents()).toBe(4900);
  });

  it("offers payment only when Stripe is set up", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeEnabled()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    expect(stripeEnabled()).toBe(true);
  });
});
