import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeError, createCheckoutSession, verifyStripeSignature } from "./stripe";

const SECRET = "whsec_test";
const NOW = new Date("2026-10-19T12:00:00Z");
const BODY = JSON.stringify({ type: "checkout.session.completed" });

function header(body = BODY, { secret = SECRET, t = NOW.getTime() / 1000 } = {}) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const verify = (body: string, h: string | null) =>
    verifyStripeSignature(body, h, { secret: SECRET, now: NOW });

  it("accepts Stripe's signature over this exact body", () => {
    expect(verify(BODY, header())).toBe(true);
  });

  it("rejects forged, tampered, stale and missing signatures", () => {
    expect(verify(BODY, header(BODY, { secret: "whsec_attacker" }))).toBe(false);
    expect(verify(`${BODY} `, header())).toBe(false);
    expect(verify(BODY, header(BODY, { t: NOW.getTime() / 1000 - 301 }))).toBe(false);
    expect(verify(BODY, null)).toBe(false);
    expect(verify(BODY, "t=1")).toBe(false);
    expect(verifyStripeSignature(BODY, header(), { secret: "", now: NOW })).toBe(false);
  });
});

describe("createCheckoutSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks Stripe for a one-time payment tied to the user", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/1" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const url = await createCheckoutSession({
      userId: "u1",
      email: "a@example.com",
      priceCents: 4900,
      baseUrl: "https://app.example.com",
    });

    expect(url).toBe("https://checkout.stripe.com/c/1");
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers.authorization).toBe("Bearer sk_test_1");
    const form = new URLSearchParams(init.body);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("4900");
    expect(form.get("client_reference_id")).toBe("u1");
    expect(form.get("success_url")).toBe("https://app.example.com/actions?membership=paid");
  });

  it("fails cleanly without a key or when Stripe refuses", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(
      createCheckoutSession({ userId: "u1", email: null, priceCents: 1, baseUrl: "x" }),
    ).rejects.toBeInstanceOf(StripeError);

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    await expect(
      createCheckoutSession({ userId: "u1", email: null, priceCents: 1, baseUrl: "x" }),
    ).rejects.toBeInstanceOf(StripeError);
  });
});
