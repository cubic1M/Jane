import { NextResponse } from "next/server";
import { TEXT_WEBHOOK_MAX_BYTES } from "@/config/messaging";
import { handleInboundText } from "@/lib/messaging/inbound";
import { webhookAuthorized } from "@/lib/messaging/provider";

// Sendblue's webhooks (spec step 78): "receive" for texts people send Jane and "outbound"
// for the status of texts Jane sent, both registered with SENDBLUE_WEBHOOK_SECRET, which
// Sendblue sends back in the sb-signing-secret header. Anything without it is refused.
// Texts from unknown numbers get a 200 and nothing else, so Sendblue doesn't retry them.

export async function POST(request: Request) {
  if (!webhookAuthorized(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = await request.text();
  if (raw.length > TEXT_WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const result = await handleInboundText(payload as Record<string, unknown>);
  return NextResponse.json({ result });
}
