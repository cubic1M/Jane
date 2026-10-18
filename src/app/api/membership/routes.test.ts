import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/membership/service", () => ({
  reserveMembership: vi.fn(),
  dismissOffer: vi.fn(),
  recordPaidMembership: vi.fn(),
}));
vi.mock("@/lib/membership/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/membership/stripe")>()),
  createCheckoutSession: vi.fn(),
}));

import { track } from "@/lib/analytics";
import { dismissOffer, recordPaidMembership, reserveMembership } from "@/lib/membership/service";
import { createCheckoutSession } from "@/lib/membership/stripe";
import { getCurrentUser } from "@/lib/session";
import { POST as webhook } from "../stripe/webhook/route";
import { POST as checkout } from "./checkout/route";
import { POST as dismiss } from "./dismiss/route";
import { POST as reserve } from "./reserve/route";

beforeEach(() => {
  vi.mocked(getCurrentUser)
    .mockReset()
    .mockResolvedValue({ id: "u1", email: "a@example.com" } as never);
  vi.mocked(reserveMembership).mockReset();
  vi.mocked(dismissOffer).mockReset();
  vi.mocked(recordPaidMembership).mockReset().mockResolvedValue(true);
  vi.mocked(createCheckoutSession).mockReset().mockResolvedValue("https://checkout.stripe.com/c/1");
  vi.mocked(track).mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("membership routes", () => {
  it("need a signed-in user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    for (const route of [reserve, dismiss, checkout]) expect((await route()).status).toBe(401);
  });

  it("reserve and dismiss act for the signed-in user", async () => {
    await reserve();
    await dismiss();
    expect(reserveMembership).toHaveBeenCalledWith("u1");
    expect(dismissOffer).toHaveBeenCalledWith("u1");
  });

  it("checkout answers 503 until Stripe is set up", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await checkout()).status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("checkout returns Stripe's URL and tracks the start", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.stubEnv("MEMBERSHIP_TEST_PRICE", "4900");

    expect(await (await checkout()).json()).toEqual({ url: "https://checkout.stripe.com/c/1" });
    expect(track).toHaveBeenCalledWith("u1", "membership_checkout_started", { price_cents: 4900 });
  });
});

describe("POST /api/stripe/webhook", () => {
  const event = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        client_reference_id: "u1",
        amount_total: 4900,
        payment_status: "paid",
      },
    },
  });
  const signed = (body: string, secret = "whsec_test") => {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    return new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": `t=${t},v1=${v1}` },
    });
  };

  beforeEach(() => vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test"));

  it("records a paid checkout", async () => {
    expect((await webhook(signed(event))).status).toBe(200);
    expect(recordPaidMembership).toHaveBeenCalledWith({
      id: "cs_test_1",
      userId: "u1",
      amountCents: 4900,
    });
  });

  it("rejects a forged webhook without recording anything", async () => {
    expect((await webhook(signed(event, "whsec_attacker"))).status).toBe(400);
    expect(recordPaidMembership).not.toHaveBeenCalled();
  });

  it("ignores unpaid sessions and other events", async () => {
    const unpaid = event.replace('"paid"', '"unpaid"');
    await webhook(signed(unpaid));
    await webhook(signed(JSON.stringify({ type: "charge.refunded", data: { object: {} } })));
    expect(recordPaidMembership).not.toHaveBeenCalled();
  });
});
