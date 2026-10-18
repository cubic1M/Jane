import { NextRequest, NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { ANONYMOUS_ID_COOKIE, isClientEvent } from "@/lib/analytics-events";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body as { name?: unknown } | null)?.name;
  if (!isClientEvent(name)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }

  const existingId = request.cookies.get(ANONYMOUS_ID_COOKIE)?.value;
  const anonymousId =
    existingId && UUID_PATTERN.test(existingId) ? existingId : crypto.randomUUID();

  await track(null, name, { anonymous_id: anonymousId });

  const response = new NextResponse(null, { status: 204 });
  if (anonymousId !== existingId) {
    response.cookies.set(ANONYMOUS_ID_COOKIE, anonymousId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  }
  return response;
}
