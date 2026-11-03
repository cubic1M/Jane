import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "trial_own_abc", email: "x@try.jane.invalid" })),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/membership/stripe", () => ({
  StripeError: class extends Error {},
  createCheckoutSession: vi.fn(async () => "https://checkout.example/session"),
}));

import { createCheckoutSession } from "@/lib/membership/stripe";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

describe("POST /api/membership/checkout", () => {
  it("never takes payment from a temporary try: there's nothing lasting to pay for", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const response = await POST();
    expect(response.status).toBe(403);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("still starts checkout for anyone else", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "cm1real",
      email: "a@example.com",
    } as never);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.example/session" });
    vi.unstubAllEnvs();
  });
});
