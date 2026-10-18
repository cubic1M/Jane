import { NextResponse } from "next/server";
import { recordPaidMembership } from "@/lib/membership/service";
import { verifyStripeSignature } from "@/lib/membership/stripe";

type CheckoutSession = {
  id?: unknown;
  client_reference_id?: unknown;
  amount_total?: unknown;
  payment_status?: unknown;
};

// Stripe's webhook. Nothing is read or changed until the signature checks out.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { type?: unknown; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const session = event.data?.object;
  if (
    event.type === "checkout.session.completed" &&
    session?.payment_status === "paid" &&
    typeof session.id === "string" &&
    typeof session.client_reference_id === "string"
  ) {
    await recordPaidMembership({
      id: session.id,
      userId: session.client_reference_id,
      amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
    });
  }
  return NextResponse.json({ received: true });
}
