import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "trial_abc", email: "x" })),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/membership/offer", () => ({
  membershipPriceCents: () => 4900,
  stripeEnabled: () => true,
}));
vi.mock("@/lib/membership/stripe", () => ({
  StripeError: class extends Error {},
  createCheckoutSession: vi.fn(async () => "https://checkout.example/x"),
}));

import { createCheckoutSession } from "@/lib/membership/stripe";
import { POST } from "./route";

describe("POST /api/membership/checkout", () => {
  // A sample person needs no account and is deleted within a day: nothing lasting to pay for, and
  // no reason for anyone to make real Stripe calls without signing up.
  it("refuses a sample person before calling Stripe", async () => {
    expect((await POST()).status).toBe(403);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});
