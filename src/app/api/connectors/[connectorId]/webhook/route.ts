import { NextResponse } from "next/server";
import { WEBHOOK_MAX_BYTES } from "@/config/connectors";
import { receiveWebhook } from "@/lib/connectors/webhooks";

// Every connector's webhooks (src/lib/connectors/webhooks.ts): the signature is checked with that
// provider's own secret before anything is read. A 404 unless CONNECTORS=1.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  // Refused before reading, when the sender says how big it is; receiveWebhook checks what arrived.
  if (Number(request.headers.get("content-length") ?? 0) > WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  const { status, body } = await receiveWebhook(connectorId, await request.text(), request.headers);
  return NextResponse.json(body, { status });
}
