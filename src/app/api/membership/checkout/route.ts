import { NextResponse } from "next/server";
import { limitOrNull } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import { appBase } from "@/lib/digest/links";
import { membershipPriceCents, stripeEnabled } from "@/lib/membership/offer";
import { StripeError, createCheckoutSession } from "@/lib/membership/stripe";
import { getCurrentUser } from "@/lib/session";

// "Become a founding member": a one-time Stripe Checkout payment. Only offered once
// Stripe keys are set; the payment itself is recorded by the Stripe webhook.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("membership", user.id);
  if (limited) return limited;
  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }

  const priceCents = membershipPriceCents();
  try {
    const url = await createCheckoutSession({
      userId: user.id,
      email: user.email ?? null,
      priceCents,
      baseUrl: appBase(),
    });
    await track(user.id, "membership_checkout_started", { price_cents: priceCents });
    return NextResponse.json({ url });
  } catch (error) {
    if (!(error instanceof StripeError)) throw error;
    console.error("Stripe checkout failed", { message: error.message });
    return NextResponse.json({ error: "Payment didn't start. Try again." }, { status: 502 });
  }
}
