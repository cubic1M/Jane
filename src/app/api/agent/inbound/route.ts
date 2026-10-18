import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleReply } from "@/lib/agent/run";

// Companies' replies to the action agent. The email provider's inbound route forwards
// each email here as JSON { to, from, subject, text }, with
// "Authorization: Bearer $AGENT_INBOUND_SECRET". When setting up the provider, check its
// inbound webhook docs and map its fields to these four (see .env.example).

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

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const to = text(body.to);
  if (!to) return NextResponse.json({ error: "Missing to" }, { status: 400 });
  const result = await handleReply(to, {
    from: text(body.from),
    subject: text(body.subject),
    body: text(body.text),
  });
  // Unknown addresses get a 200 too, so the provider doesn't retry them forever.
  return NextResponse.json({ result });
}
