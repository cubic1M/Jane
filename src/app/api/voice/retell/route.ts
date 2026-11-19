import { NextResponse } from "next/server";
import { callResultOf, retellSignatureValid, type RetellCall } from "@/lib/voice/retell/api";
import { handleCallResult } from "@/lib/voice/calls";

// Retell's webhook for the action agent's test calls (src/lib/voice/retell/): { event, call },
// signed in X-Retell-Signature with the API key. Only `call_analyzed` carries a result; the call's
// metadata.token is the action's reply token it was placed with. Other events are acknowledged.

const MAX_BYTES = 300_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (!retellSignatureValid(raw, request.headers.get("x-retell-signature"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { event?: unknown; call?: RetellCall };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.event !== "call_analyzed") return new NextResponse(null, { status: 204 });
  const token = body.call?.metadata?.token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }
  const result = await handleCallResult(token, callResultOf(body.call ?? {}));
  return NextResponse.json({ result });
}
