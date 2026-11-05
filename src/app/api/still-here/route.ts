import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

// Whose session this is, for a page that came up from the browser's memory (src/lib/page-cache.ts).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ id: user.id }, { headers: { "cache-control": "no-store" } });
}
