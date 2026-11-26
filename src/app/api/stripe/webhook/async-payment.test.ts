import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/membership/service", () => ({ recordPaidMembership: vi.fn(async () => true) }));

import { recordPaidMembership } from "@/lib/membership/service";
import { POST } from "./route";

const signed = (type: string, payment_status: string) => {
  const body = JSON.stringify({
    type,
    data: {
      object: { id: "cs_test_1", client_reference_id: "u1", amount_total: 4900, payment_status },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
  });
};

describe("a membership paid by a method that takes days", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Checkout completes unpaid; Stripe sends this when the money arrives.
  it("is recorded when the payment succeeds", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    await POST(signed("checkout.session.completed", "unpaid"));
    expect(recordPaidMembership).not.toHaveBeenCalled();
    await POST(signed("checkout.session.async_payment_succeeded", "paid"));
    expect(recordPaidMembership).toHaveBeenCalledWith({
      id: "cs_test_1",
      userId: "u1",
      amountCents: 4900,
    });
  });

  it("is not recorded when it fails", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.mocked(recordPaidMembership).mockClear();
    await POST(signed("checkout.session.async_payment_failed", "unpaid"));
    expect(recordPaidMembership).not.toHaveBeenCalled();
  });
});
