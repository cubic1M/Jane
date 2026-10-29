import { NextResponse } from "next/server";
import { recordRun } from "@/lib/health";
import { fillTrialPool } from "@/lib/trial-pool";

// Each sample person takes a few seconds to scan.
export const maxDuration = 120;

// Vercel Cron, daily: sample people made ahead for the /try link (src/lib/trial-pool.ts), so a
// reviewer opening it after a quiet day still gets one already scanned. Each visitor's own
// visit tops it up too. Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    await recordRun("try-pool", async () => ({ made: await fillTrialPool() })),
  );
}
