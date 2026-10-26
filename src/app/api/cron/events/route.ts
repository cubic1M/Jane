import { NextResponse } from "next/server";
import { recordRun } from "@/lib/health";
import { runEventsForAll } from "@/lib/events/run";

// GDELT asks for one request every 5 seconds, so reading every event type takes about a minute.
export const maxDuration = 300;

// Vercel Cron, daily after the paper accounts' run: today's events (GDELT's coverage, the Fed's,
// BLS's and EIA's feeds, the stored headlines, the day's price moves), then the events overlay on
// every paper account that has it on. Simulated only: nothing here places a real order. Vercel
// sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordRun("events", () => runEventsForAll()));
}
