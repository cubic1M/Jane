import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", async () => {
  const { TERMS_VERSION } = await import("@/config/legal");
  const user = { id: "u1", email: "a@example.com", termsVersion: TERMS_VERSION };
  return { getCurrentUser: vi.fn(async () => user) };
});
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(async () => {
    throw new Error("database down");
  }),
}));
vi.mock("@/lib/membership/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/membership/stripe")>()),
  createCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/c/1"),
}));

import { POST } from "./route";

describe("starting a membership checkout", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives the payment page even when counting the start fails", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    expect(await (await POST()).json()).toEqual({ url: "https://checkout.stripe.com/c/1" });
  });
});
