import { NextResponse, after } from "next/server";
import { log } from "@/lib/log";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";
import { firstDelivery, forgetDelivery, planWebhook, syncFromWebhook } from "@/lib/plaid/webhooks";

// Plaid's webhooks: what keeps each bank's data fresh (the daily job is only the backstop).
// Nothing is read or changed until the signature checks out; a delivery Plaid repeats is
// acknowledged and ignored; syncs run after the response so Plaid isn't kept waiting.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const verified = await verifyPlaidWebhook(rawBody, request.headers.get("plaid-verification"));
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: Parameters<typeof planWebhook>[0];
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!(await firstDelivery(rawBody, body))) return NextResponse.json({ received: true });
  let plan: Awaited<ReturnType<typeof planWebhook>>;
  try {
    plan = await planWebhook(body);
  } catch (error) {
    // The 500 makes Plaid send it again, and that one must not look like a repeat.
    await forgetDelivery(rawBody);
    throw error;
  }
  if (plan?.sync) {
    after(async () => {
      try {
        await syncFromWebhook(plan.itemId);
      } catch (error) {
        // A PlaidRequestError's message is its code and status only: never the request.
        log.error("Plaid sync from webhook failed", {
          itemId: plan.itemId,
          error: String(error),
        });
      }
    });
  }
  return NextResponse.json({ received: true });
}
