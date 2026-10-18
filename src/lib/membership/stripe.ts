import { createHmac, timingSafeEqual } from "node:crypto";
import { STRIPE_WEBHOOK_TOLERANCE_SECONDS } from "@/config/membership";

// The two Stripe calls this test needs, over Stripe's REST API: create a Checkout
// session for a one-time payment, and verify a webhook's signature
// (https://docs.stripe.com/webhooks#verify-manually).

const CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";

export class StripeError extends Error {}

export async function createCheckoutSession({
  userId,
  email,
  priceCents,
  baseUrl,
}: {
  userId: string;
  email: string | null;
  priceCents: number;
  baseUrl: string;
}): Promise<string> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("Stripe isn't set up");
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(priceCents),
    "line_items[0][price_data][product_data][name]": "Founding membership",
    client_reference_id: userId,
    "metadata[user_id]": userId,
    success_url: `${baseUrl}/actions?membership=paid`,
    cancel_url: `${baseUrl}/actions`,
    ...(email ? { customer_email: email } : {}),
  });
  const response = await fetch(CHECKOUT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: { type?: string };
  };
  if (!response.ok || !body.url) {
    throw new StripeError(`Checkout session failed (${response.status} ${body.error?.type ?? ""})`);
  }
  return body.url;
}

// True when the Stripe-Signature header is a valid signature of this exact body, made
// with STRIPE_WEBHOOK_SECRET within the tolerance window.
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  {
    secret = process.env.STRIPE_WEBHOOK_SECRET,
    now = new Date(),
  }: { secret?: string; now?: Date } = {},
): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
