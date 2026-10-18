import { NextRequest, NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { ANONYMOUS_ID_COOKIE, isClientEvent } from "@/lib/analytics-events";
import { getCurrentUser } from "@/lib/session";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, findingId } = (body ?? {}) as { name?: unknown; findingId?: unknown };
  if (!isClientEvent(name)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }
  if (findingId !== undefined && (typeof findingId !== "string" || !ID_PATTERN.test(findingId))) {
    return NextResponse.json({ error: "Invalid finding id" }, { status: 400 });
  }

  const existingId = request.cookies.get(ANONYMOUS_ID_COOKIE)?.value;
  const anonymousId =
    existingId && UUID_PATTERN.test(existingId) ? existingId : crypto.randomUUID();

  // Signed-in pages (the report, cards) attribute their events to the user.
  const user = await getCurrentUser();
  await track(user?.id ?? null, name, {
    anonymous_id: anonymousId,
    ...(findingId ? { finding_id: findingId } : {}),
  });

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
