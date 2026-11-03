import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alertError } from "@/lib/error-alerts";
import { describeError, recordError } from "@/lib/error-log";
import { recordRun } from "@/lib/health";
import { ProbeFailed, runProbe } from "@/lib/probe";

export const maxDuration = 120;

// The hourly sign-in and cross-user check (src/lib/probe.ts), started by
// .github/workflows/probe.yml with "Authorization: Bearer $PROBE_SECRET". Vercel Hobby can't run a
// cron hourly. Without PROBE_SECRET it refuses everyone, so nothing runs until a founder sets it.
export async function GET(request: Request) {
  const secret = process.env.PROBE_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const base = new URL(request.url).origin;
  try {
    const result = await recordRun("probe", async () => {
      const outcome = await runProbe(base);
      if (!outcome.ok) throw new ProbeFailed(outcome);
      return outcome;
    });
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof ProbeFailed)) throw error;
    const path = "/api/cron/probe";
    await recordError(error, { path, method: "GET", routeType: "route" }, db);
    await alertError({ message: describeError(error).message, path }, { client: db });
    return NextResponse.json(error.result, { status: 503 });
  }
}
