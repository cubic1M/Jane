import { NextResponse } from "next/server";
import {
  recordEmailEvent,
  verifyResendSignature,
  type EmailEvent,
} from "@/lib/digest/resend-webhook";

// Resend's webhook (email.opened, email.complained) for the weekly email. Nothing is read or
// changed until the signature checks out.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyResendSignature(rawBody, request.headers, process.env.RESEND_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: EmailEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  return NextResponse.json({ received: true, result: await recordEmailEvent(event) });
}
