import { NextResponse, after } from "next/server";
import { syncItem } from "@/lib/plaid/sync";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";
import { planWebhook } from "@/lib/plaid/webhooks";

// Plaid's webhooks. Nothing is read or changed until the signature checks out; syncs run
// after the response so Plaid isn't kept waiting.
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

  const plan = await planWebhook(body);
  if (plan?.sync) {
    after(async () => {
      try {
        await syncItem(plan.itemId);
      } catch (error) {
        console.error("Plaid sync from webhook failed", {
          itemId: plan.itemId,
          error: String(error),
        });
      }
    });
  }
  return NextResponse.json({ received: true });
}
