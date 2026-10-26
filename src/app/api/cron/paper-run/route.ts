import { NextResponse } from "next/server";
import { recordRun } from "@/lib/health";
import { runPaperDayForAll } from "@/lib/paper/account";

// Vercel Cron, daily after the US market closes: every paper account valued at the day's real
// closes, and its strategy's trades left in the trade pop-up. Simulated only: nothing here places
// a real order. Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordRun("paper-run", () => runPaperDayForAll()));
}
