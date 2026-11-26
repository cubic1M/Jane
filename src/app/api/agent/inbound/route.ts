import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tokenFromAddress } from "@/lib/agent/mail";
import { readReceivedEmail } from "@/lib/agent/received-email";
import { handleReply } from "@/lib/agent/run";
import { verifyResendSignature } from "@/lib/digest/resend-webhook";

// Companies' replies to the action agent, two ways (.env.example):
// - Resend's `email.received` webhook, signed with AGENT_INBOUND_WEBHOOK_SECRET. The email is then
//   read from Resend, with its DMARC result.
// - Another provider's inbound route, forwarding JSON { to, from, subject, text, authentication }
//   with "Authorization: Bearer $AGENT_INBOUND_SECRET", authentication being the provider's own
//   { dmarc } result for the email.
// A reply counts as the company's only when DMARC passed: the From line is the sender's to write,
// and the token in the address is in every email to the company.

const MAX_BYTES = 200_000;

function authorized(request: Request): boolean {
  const secret = process.env.AGENT_INBOUND_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// The body as an object, or null: "null", a number or a list is valid JSON with nothing to read.
function jsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (request.headers.has("svix-signature")) return fromResend(raw, request.headers);
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = jsonObject(raw);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const to = text(body.to);
  if (!to) return NextResponse.json({ error: "Missing to" }, { status: 400 });
  const authentication = (body.authentication ?? {}) as { dmarc?: unknown };
  const result = await handleReply(to, {
    from: text(body.from),
    subject: text(body.subject),
    body: text(body.text),
    verified: authentication.dmarc === "pass",
  });
  // Unknown addresses get a 200 too, so the provider doesn't retry them forever.
  return NextResponse.json({ result });
}

async function fromResend(raw: string, headers: Headers) {
  if (!verifyResendSignature(raw, headers, process.env.AGENT_INBOUND_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const event = jsonObject(raw) as { type?: unknown; data?: { email_id?: unknown } } | null;
  if (!event) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (event.type !== "email.received") return NextResponse.json({ result: "ignored" });
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string")
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const email = await readReceivedEmail(emailId);
  // Resend didn't answer: a 503, so it delivers the webhook again.
  if (!email) return NextResponse.json({ error: "Couldn't read the email" }, { status: 503 });
  const to = email.to.find((address) => tokenFromAddress(address));
  if (!to) return NextResponse.json({ result: "unknown" });
  const result = await handleReply(to, {
    from: email.from,
    subject: email.subject,
    body: email.text,
    verified: email.verified,
  });
  return NextResponse.json({ result });
}
