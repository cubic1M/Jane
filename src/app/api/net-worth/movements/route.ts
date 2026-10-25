import { NextResponse } from "next/server";
import { encodeMovements } from "@/insights/net-worth-movements";
import { netWorthMovements } from "@/lib/hub/net-worth-events";
import { getCurrentUser } from "@/lib/session";

// Every movement since `from` for the expanded net worth chart (src/insights/net-worth-movements.ts),
// fetched when the chart opens so the collapsed hero stays light. The signed-in person's own,
// compact, never cached.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const from = new URL(request.url).searchParams.get("from") ?? "";
  if (!DAY.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
    return NextResponse.json({ error: "from must be a day, like 2026-01-31" }, { status: 400 });
  }
  const events = await netWorthMovements(user.id, from);
  return NextResponse.json(encodeMovements(from, events), {
    headers: { "cache-control": "no-store" },
  });
}
