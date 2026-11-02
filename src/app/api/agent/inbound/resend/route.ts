import { NextResponse } from "next/server";
import { handleReply } from "@/lib/agent/run";
import { tokenFromAddress } from "@/lib/agent/mail";
import { fetchReceivedEmail, verifySvix } from "@/lib/agent/resend-inbound";

// Resend's inbound webhook, for when real mail is turned on (see src/lib/agent/resend-inbound.ts).
// Nothing answers without RESEND_WEBHOOK_SECRET set, and the agent writes to no real company while
// CONCIERGE_ACTIONS.realAccounts is false.

const MAX_BYTES = 200_000;

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const signed = verifySvix(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
    new Date(),
  );
  if (!signed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { type?: unknown; data?: { email_id?: unknown; to?: unknown } };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Other events get a 200, so Resend doesn't retry them.
  if (body.type !== "email.received") return NextResponse.json({ result: "ignored" });
  const emailId = body.data?.email_id;
  if (typeof emailId !== "string" || !emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }
  const mail = await fetchReceivedEmail(emailId, { apiKey });
  const to = mail.to.find((address) => tokenFromAddress(address) !== null);
  if (!to) return NextResponse.json({ result: "unknown" });
  const result = await handleReply(to, { from: mail.from, subject: mail.subject, body: mail.text });
  return NextResponse.json({ result });
}
