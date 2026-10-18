import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleCallResult } from "@/lib/voice/calls";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/voice/provider";

// A calling service's result for one of the agent's calls, as JSON:
// { token, outcome, transcript, newMonthlyCents?, offer?, offerTerms? }, with
// "Authorization: Bearer $VOICE_WEBHOOK_SECRET". token is the one the call was placed with;
// outcome is one of lowered, offer, refused, needs_person or no_answer; offerTerms is
// { monthlyCents, contractMonths, feeCents } for an offer.

const MAX_BYTES = 200_000;

function authorized(request: Request): boolean {
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

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
  const { token, outcome, transcript, newMonthlyCents, offer, offerTerms } = body;
  const cents = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const terms = offerTerms as Record<string, unknown> | undefined | null;
  if (
    terms !== undefined &&
    terms !== null &&
    !(cents(terms.monthlyCents) && cents(terms.contractMonths) && cents(terms.feeCents))
  ) {
    return NextResponse.json({ error: "Invalid offer terms" }, { status: 400 });
  }
  if (
    typeof token !== "string" ||
    !CALL_OUTCOMES.includes(outcome as CallOutcome) ||
    typeof transcript !== "string" ||
    (newMonthlyCents !== undefined &&
      newMonthlyCents !== null &&
      (!Number.isInteger(newMonthlyCents) || (newMonthlyCents as number) < 0))
  ) {
    return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  }
  const result = await handleCallResult(token, {
    outcome: outcome as CallOutcome,
    transcript,
    newMonthlyCents: typeof newMonthlyCents === "number" ? newMonthlyCents : null,
    offer: typeof offer === "string" ? offer : null,
    offerTerms: terms
      ? {
          monthlyCents: terms.monthlyCents as number,
          contractMonths: terms.contractMonths as number,
          feeCents: terms.feeCents as number,
        }
      : null,
  });
  return NextResponse.json({ result });
}
