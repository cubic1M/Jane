import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { systemDb } from "@/lib/system-db";

// Whose session this is, for a page that came up from the browser's memory (src/lib/page-cache.ts).
// Auth.js answers "no session" when the database failed too, and a person isn't signed out by that:
// a no is only a no if the database can answer.
export async function GET() {
  const user = await getCurrentUser();
  if (user) {
    return NextResponse.json({ id: user.id }, { headers: { "cache-control": "no-store" } });
  }
  const up = await systemDb("Is the database answering: nobody's data").$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
  return up
    ? NextResponse.json({ error: "Not signed in" }, { status: 401 })
    : NextResponse.json({ error: "Try again" }, { status: 503 });
}
