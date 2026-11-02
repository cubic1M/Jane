import { NextResponse } from "next/server";
import { handleCallResult } from "@/lib/voice/calls";
import { callResultOf, verifyRetellSignature } from "@/lib/voice/retell";

// Retell's webhooks, for when real calls are turned on (see src/lib/voice/retell.ts). Nothing answers
// without RETELL_API_KEY set. Retell retries without a 2xx in 10 seconds, so repeats are harmless:
// handleCallResult only acts while the agent is waiting.

const MAX_BYTES = 500_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const signed = verifyRetellSignature(
    raw,
    request.headers.get("x-retell-signature"),
    process.env.RETELL_API_KEY ?? "",
    new Date(),
  );
  if (!signed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let payload: Parameters<typeof callResultOf>[0];
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = callResultOf(payload);
  if (!parsed) return new NextResponse(null, { status: 204 });
  await handleCallResult(parsed.token, parsed.result);
  return new NextResponse(null, { status: 204 });
}
