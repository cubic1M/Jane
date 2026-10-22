import { NextResponse } from "next/server";
import { recordRun } from "@/lib/health";
import { runPracticeDayForAll } from "@/lib/practice/scan";

// Vercel Cron, daily after the US market closes (spec step 292, Phase AW, Stage A): the scan of
// every practice portfolio and its autopilot, in the practice ledger only. Nothing here places
// a real order or reads a real account. Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordRun("practice-scan", () => runPracticeDayForAll()));
}
