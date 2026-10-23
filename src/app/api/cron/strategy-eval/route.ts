import { NextResponse } from "next/server";
import { recordRun } from "@/lib/health";
import { runStrategyEvaluation } from "@/lib/investments/strategy-eval";

// Vercel Cron, daily after the history load (Phase AW, Stage A): every strategy replayed
// for every level over the stored Alpaca closes, and each level's choice saved
// (src/lib/investments/strategy-eval.ts). Reads stored prices only: no call out, no order.
// Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await recordRun("strategy-eval", () => runStrategyEvaluation()));
}
