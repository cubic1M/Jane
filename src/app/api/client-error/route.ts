import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { describeClientError } from "@/lib/client-errors";

// A page that broke in the browser (src/app/error.tsx) tells /admin/errors: scrubbed of anything
// typed (src/lib/client-errors.ts). Server errors are logged where they happen (instrumentation),
// so the page sends only the ones the server never saw. Rate-limited with the other /api routes
// (src/lib/edge-limits.ts).
const MAX_BODY = 8 * 1024;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const error = describeClientError(parsed);
  if (!error) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await db.errorEvent.create({ data: { ...error, method: null, routeType: "client" } });
  } catch {
    // Never let error logging cause another error.
  }
  return NextResponse.json({ ok: true });
}
